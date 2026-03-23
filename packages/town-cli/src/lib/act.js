const { runAuthenticated, formatWalk, formatChatSend, formatInteract, parseFlags } = require('./core');

function throwForAuth(auth) {
  if (!auth) return;
  throw new Error(auth.message || '当前无法执行该操作，请先 login。');
}

async function point(args) {
  const { auth, result } = await runAuthenticated('GET', '/api/waypoints');
  if (!result) throwForAuth(auth);
  
  console.log('🗺️  路标点列表:');
  console.log('');
  
  result.waypoints.forEach(waypoint => {
    console.log(`Id：${waypoint.id}，Name：${waypoint.name}，Type：${waypoint.type}`);
  });
  
  console.log('');
  console.log('使用: node town walk <pointId> 来导航到指定路标点');
  console.log('');
  console.log('示例: node town walk wp_building_武器防具店_weapon_and_armor_store_');
}

async function walk(args) {
  const flags = parseFlags(args);
  const pointId = flags._[0];
  
  // 检查是否是通过路标点 ID 导航
  if (pointId && !flags.direction && !flags.steps) {
    const { auth, result } = await runAuthenticated('POST', '/api/walk-to-point', { pointId });
    if (!result) throwForAuth(auth);
    
    if (result.success) {
      console.log(`✅ 成功导航到路标点: ${pointId}`);
      console.log(`📍 移动了 ${result.actualSteps} 步`);
    } else {
      console.log(`❌ 导航失败: ${result.message || '未知错误'}`);
    }
    return;
  }
  
  // 原有的通过方向和步数移动
  const direction = flags.direction || flags._[0];
  const rawSteps = flags.steps || flags._[1];
  const steps = Number(rawSteps);
  if (!direction || !Number.isFinite(steps)) {
    throw new Error('用法: town walk <pointId> 或 town walk --direction <N|S|W|E> --steps <步数>');
  }

  const { auth, result } = await runAuthenticated('POST', '/api/walk', { direction, steps });
  if (!result) throwForAuth(auth);
  console.log(formatWalk(direction, steps));
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
  console.log(formatInteract(result));
}

module.exports = { point, walk, chat, interact };
