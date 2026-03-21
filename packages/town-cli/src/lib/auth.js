const { login, listProfiles, formatLogin, formatProfilesList, parseFlags } = require('./core');

async function loginCommand(args) {
  const flags = parseFlags(args);
  const result = await login({
    profile: flags.profile,
    create: Boolean(flags.create),
    name: flags.name,
    sprite: flags.sprite,
    loginMode: flags['login-mode'],
    respawn: Boolean(flags.respawn),
  });
  console.log(formatLogin(result));
}

function listProfileCommand() {
  console.log(formatProfilesList(listProfiles()));
}

module.exports = {
  login: loginCommand,
  listProfile: listProfileCommand,
};
