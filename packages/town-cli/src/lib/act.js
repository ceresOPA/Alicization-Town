const { runAuthenticated, formatWalk, formatSay, formatInteract, parseFlags } = require('./core');

function throwForAuth(auth) {
  if (!auth) return;
  throw new Error(auth.message || '当前无法执行该操作，请先 login。');
}

async function walk(args) {
  const flags = parseFlags(args);
  const direction = flags.direction || flags._[0];
  const rawSteps = flags.steps || flags._[1];
  const steps = Number(rawSteps);
  if (!direction || !Number.isFinite(steps)) {
    throw new Error('用法: town walk --direction <N|S|W|E> --steps <步数>');
  }

  const { auth, result } = await runAuthenticated('POST', '/api/walk', { direction, steps });
  if (!result) throwForAuth(auth);
  console.log(formatWalk(direction, steps, result));
}

async function say(args) {
  const flags = parseFlags(args);
  const text = flags.text || flags._.join(' ');
  if (!text) {
    throw new Error('用法: town say --text <消息内容>');
  }

  const { auth, result } = await runAuthenticated('POST', '/api/say', { text });
  if (!result) throwForAuth(auth);
  console.log(formatSay(text));
}

async function interact() {
  const { auth, result } = await runAuthenticated('POST', '/api/interact');
  if (!result) throwForAuth(auth);
  console.log(formatInteract(result));
}

module.exports = { walk, say, interact };
