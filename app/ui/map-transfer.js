// Markdown/text clipboard and file drops share one append operation. Images
// remain a separate map-attachment feature.
/** @param {DataTransfer} transfer @returns {Promise<string>} */
export async function mapTransferText(transfer) {
  const files = [...(transfer.files ?? [])].filter((file) =>
    /\.(md|markdown|txt)$/i.test(file.name),
  );
  if (files.length) return (await Promise.all(files.map((file) => file.text()))).join('\n\n');
  if (transfer.files?.length) return '';
  return transfer.getData('text/markdown') || transfer.getData('text/plain');
}
