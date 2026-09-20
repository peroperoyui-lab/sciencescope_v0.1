// Test-only readiness carrier: API is owned by the fixture runner, not this child.
const url=new URL(process.env.SCIENCESCOPE_TEST_HOST_URL||'');
if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')throw new Error('Local fixture URL required');
console.log(JSON.stringify({url:url.href}));
setInterval(()=>{},10000);
