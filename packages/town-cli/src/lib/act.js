const { runAuthenticated, formatWalk, formatChatSend, formatInteract, appendAutoMemories, appendMemorySection, parseFlags } = require('./core');

function throwForAuth(auth) {
  if (!auth) return;
  throw new Error(auth.message || '当前无法执行该操作，请先 login。');
}

async function walk(args) {
  const flags = parseFlags(args);
  const target = {};
  if (flags.to || flags._[0]) target.to = flags.to || flags._.join(' ');
  if (flags.x !== undefined) target.x = Number(flags.x);
  if (flags.y !== undefined) target.y = Number(flags.y);
  if (flags.forward !== undefined) target.forward = Number(flags.forward);
  if (flags.right !== undefined) target.right = Number(flags.right);

  if (!target.to && target.x === undefined && target.forward === undefined && target.right === undefined) {
    throw new Error('用法: town walk --to <地名> | --x <X> --y <Y> | --forward <N> --right <N>');
  }

  const { auth, result } = await runAuthenticated('POST', '/api/walk', target);
  if (!result) throwForAuth(auth);
  if (result.error) throw new Error(result.error);
  console.log(formatWalk(result));
}

async function chat(args) {
  const flags = parseFlags(args);
  const text = flags.text || flags._.join(' ');
  if (!text) {
    throw new Error('用法: town chat --text <消息内容>');
  }

  const { auth, result } = await runAuthenticated('POST', '/api/chat', { text });
  if (!result) throwForAuth(auth);
  console.log(formatChatSend(text));
}

async function interact() {
  const { auth, result } = await runAuthenticated('POST', '/api/interact');
  if (!result) throwForAuth(auth);
  let text = formatInteract(result);
  text = await appendAutoMemories(
    'interact',
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

module.exports = { walk, chat, interact };
