const { runAuthenticated, formatLook, formatMap, appendAutoMemories, appendMemorySection } = require('./core');

function throwForAuth(auth) {
  if (!auth) return;
  throw new Error(auth.message || '当前无法执行该操作，请先 login。');
}

async function look() {
  const { auth, result } = await runAuthenticated('GET', '/api/look');
  if (!result) throwForAuth(auth);
  let text = formatLook(result);
  text = await appendAutoMemories(
    'look',
    result,
    text,
    async (memoryContext) => {
      const recalled = await runAuthenticated('POST', '/api/memories/recall', memoryContext);
      return recalled.result?.memories || [];
    },
    appendMemorySection,
  );
  console.log(text);
}

async function map() {
  const { auth, result } = await runAuthenticated('GET', '/api/map');
  if (!result) throwForAuth(auth);
  console.log(formatMap(result.directory));
}

module.exports = { look, map };
