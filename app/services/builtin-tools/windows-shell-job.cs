// Uses the same Windows Job API as src-tauri/src/main.rs. A separate owner is
// needed here: a shell can exit while its descendants still own output pipes.
// PS5 writes to the append-only output file: its inherited duplicate handles
// must not delay completion or break background writers when the shell exits.
// Pipe-based shells still drain their output. Only cancellation, timeout or
// owner loss kills the job; normal completion releases background processes.
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

internal static class WindowsShellJob
{
    private const uint KillOnClose = 0x2000;
    private static readonly object Gate = new object();
    private static IntPtr job;
    private static bool released;

    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes
    {
        public int Length;
        public IntPtr Descriptor;
        public int Inherit;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits
    {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimits
    {
        public BasicLimits Basic;
        public ulong ReadOperations, WriteOperations, OtherOperations;
        public ulong ReadBytes, WriteBytes, OtherBytes;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Accounting
    {
        public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
        public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int Size;
        public string Reserved, Desktop, Title;
        public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
        public ushort Show, ReservedSize;
        public IntPtr ReservedBytes, Input, Output, Error;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInfo
    {
        public IntPtr Process, Thread;
        public uint ProcessId, ThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfoEx
    {
        public StartupInfo Startup;
        public IntPtr Attributes;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateJobObjectW(IntPtr attributes, IntPtr name);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr handle, int kind, ref ExtendedLimits limits, int size);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(IntPtr handle, int kind, out Accounting accounting, int size, IntPtr length);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr handle, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr handle, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SecurityAttributes attributes, uint size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFileW(string name, uint access, uint sharing, ref SecurityAttributes attributes, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint code);

    private static void Check(bool success)
    {
        if (!success) throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    private static void SetKillOnClose(bool enabled)
    {
        var limits = new ExtendedLimits();
        limits.Basic.Flags = enabled ? KillOnClose : 0;
        Check(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(ExtendedLimits))));
    }

    private static string Quote(string value)
    {
        var quoted = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            quoted.Append('\\', character == '"' ? slashes * 2 + 1 : slashes);
            quoted.Append(character);
            slashes = 0;
        }
        quoted.Append('\\', slashes * 2);
        return quoted.Append('"').ToString();
    }

    private static Thread Forward(IntPtr handle, Stream destination)
    {
        var thread = new Thread(delegate()
        {
            try
            {
                using (var input = new FileStream(new SafeFileHandle(handle, true), FileAccess.Read))
                    input.CopyTo(destination);
                destination.Flush();
            }
            catch (Exception)
            {
                // A lost parent/output consumer must not leave commands running.
                Stop();
            }
        });
        thread.Start();
        return thread;
    }

    private static void Stop()
    {
        lock (Gate)
        {
            if (released) return;
            Check(TerminateJobObject(job, 1));
            Accounting accounting;
            do
            {
                Check(QueryInformationJobObject(job, 1, out accounting, Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
                if (accounting.ActiveProcesses != 0) Thread.Sleep(10);
            } while (accounting.ActiveProcesses != 0);
        }
    }

    private static IntPtr OpenOutput(string file, ref SecurityAttributes security)
    {
        // FILE_APPEND_DATA avoids independent stdout/stderr cursors overwriting
        // each other; share reading and writing with the caller and descendants.
        IntPtr handle = CreateFileW(file, 0x4, 7, ref security, 4, 0x80, IntPtr.Zero);
        Check(handle != new IntPtr(-1));
        return handle;
    }

    private static int Main(string[] args)
    {
        ProcessInfo process = new ProcessInfo();
        IntPtr outputRead = IntPtr.Zero, outputWrite = IntPtr.Zero;
        IntPtr errorRead = IntPtr.Zero, errorWrite = IntPtr.Zero, input = IntPtr.Zero;
        IntPtr attributes = IntPtr.Zero, inheritedHandles = IntPtr.Zero;
        try
        {
            bool fileOutput = args[0] == "--output-file";
            int commandStart = fileOutput ? 2 : 0;
            job = CreateJobObjectW(IntPtr.Zero, IntPtr.Zero);
            Check(job != IntPtr.Zero);
            SetKillOnClose(true);
            // Only command output handles are inherited, never the owner's
            // control pipe or its Node-facing diagnostic output handles.
            for (int kind = -10; kind >= -12; kind--)
                Check(SetHandleInformation(GetStdHandle(kind), 1, 0));
            var security = new SecurityAttributes();
            security.Length = Marshal.SizeOf(typeof(SecurityAttributes));
            security.Inherit = 1;
            if (fileOutput)
            {
                outputWrite = OpenOutput(args[1], ref security);
                errorWrite = OpenOutput(args[1], ref security);
            }
            else
            {
                Check(CreatePipe(out outputRead, out outputWrite, ref security, 0));
                Check(CreatePipe(out errorRead, out errorWrite, ref security, 0));
                Check(SetHandleInformation(outputRead, 1, 0));
                Check(SetHandleInformation(errorRead, 1, 0));
            }
            input = CreateFileW("NUL", 0x80000000, 3, ref security, 3, 0, IntPtr.Zero);
            Check(input != new IntPtr(-1));
            var startup = new StartupInfoEx();
            startup.Startup.Size = Marshal.SizeOf(typeof(StartupInfoEx));
            startup.Startup.Flags = 0x100;
            startup.Startup.Input = input;
            startup.Startup.Output = outputWrite;
            startup.Startup.Error = errorWrite;
            // The CLR can own additional inherited copies of standard handles.
            // An explicit allowlist also excludes those from descendants.
            IntPtr attributeSize = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
            attributes = Marshal.AllocHGlobal(attributeSize);
            Check(InitializeProcThreadAttributeList(attributes, 1, 0, ref attributeSize));
            inheritedHandles = Marshal.AllocHGlobal(IntPtr.Size * 3);
            Marshal.Copy(new[] { input, outputWrite, errorWrite }, 0, inheritedHandles, 3);
            Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002),
                inheritedHandles, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero));
            startup.Attributes = attributes;
            var command = new StringBuilder();
            for (int index = commandStart; index < args.Length; index++)
                command.Append(Quote(args[index])).Append(' ');
            // No descendant can escape between creation and assignment.
            Check(CreateProcessW(args[commandStart], command, IntPtr.Zero, IntPtr.Zero, true,
                0x08080004, IntPtr.Zero, null, ref startup, out process));
            Check(AssignProcessToJobObject(job, process.Process));
            CloseHandle(outputWrite); outputWrite = IntPtr.Zero;
            CloseHandle(errorWrite); errorWrite = IntPtr.Zero;
            CloseHandle(input); input = IntPtr.Zero;
            Thread outputThread = null, errorThread = null;
            if (!fileOutput)
            {
                outputThread = Forward(outputRead, Console.OpenStandardOutput());
                outputRead = IntPtr.Zero;
                errorThread = Forward(errorRead, Console.OpenStandardError());
                errorRead = IntPtr.Zero;
            }
            var control = new Thread(delegate()
            {
                try { Console.OpenStandardInput().ReadByte(); Stop(); }
                catch (Exception) { Environment.Exit(125); }
            });
            control.IsBackground = true;
            control.Start();
            Check(ResumeThread(process.Thread) != uint.MaxValue);
            Check(WaitForSingleObject(process.Process, uint.MaxValue) == 0);
            uint code;
            Check(GetExitCodeProcess(process.Process, out code));
            if (outputThread != null) outputThread.Join();
            if (errorThread != null) errorThread.Join();
            lock (Gate)
            {
                // Redirected background processes survive a normal completion,
                // just as they did before per-command jobs were introduced.
                SetKillOnClose(false);
                released = true;
            }
            return unchecked((int)code);
        }
        catch (Exception error)
        {
            if (process.Process != IntPtr.Zero)
            {
                TerminateProcess(process.Process, 1);
                WaitForSingleObject(process.Process, uint.MaxValue);
            }
            Console.Error.WriteLine("Windows shell job failed: " + error.Message);
            return 125;
        }
        finally
        {
            if (attributes != IntPtr.Zero)
            {
                DeleteProcThreadAttributeList(attributes);
                Marshal.FreeHGlobal(attributes);
            }
            if (inheritedHandles != IntPtr.Zero) Marshal.FreeHGlobal(inheritedHandles);
            foreach (IntPtr handle in new[] { process.Thread, process.Process, outputRead,
                outputWrite, errorRead, errorWrite, input, job })
                if (handle != IntPtr.Zero && handle != new IntPtr(-1)) CloseHandle(handle);
        }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);
}
