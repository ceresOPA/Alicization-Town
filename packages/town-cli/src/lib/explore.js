const { runAuthenticated, formatLook, formatMap, appendMemorySection } = require('./core');

function throwForAuth(auth) {
  if (!auth) return;
  throw new Error(auth.message || '当前无法执行该操作，请先 login。');
}

async function look() {
  const { auth, result } = await runAuthenticated('GET', '/api/look');
  if (!result) throwForAuth(auth);
  let text = formatLook(result);
  const recalled = await runAuthenticated('POST', '/api/memories/recall', {
    location: result.player?.zone || null,
    partnerId: result.nearby?.[0]?.id || null,
    limit: 4,
  });
  if (recalled.result?.memories?.length) {
    text = appendMemorySection(text, recalled.result.memories);
  }
  console.log(text);
}

async function map() {
  const { auth, result } = await runAuthenticated('GET', '/api/map');
  if (!result) throwForAuth(auth);
  let text = formatMap(result.directory);
  const recalled = await runAuthenticated('POST', '/api/memories/recall', { limit: 3 });
  if (recalled.result?.memories?.length) {
    text = appendMemorySection(text, recalled.result.memories);
  }
  console.log(text);
}

module.exports = { look, map };
