class PathExecutor {
  constructor(worldEngine) {
    this.worldEngine = worldEngine;
  }

  // 执行路径
  executePath(playerId, path, pointId = null) {
    if (!path || path.length === 0) {
      return { success: false, message: '路径为空' };
    }

    let actualSteps = 0;
    let blocked = false;
    let currentPathIndex = 0;
    const targetPos = path[path.length - 1];

    // 获取玩家信息
    const player = this.worldEngine.getAllPlayers()[playerId];
    const playerName = player ? player.name : 'Unknown';

    // 获取起点路标点 ID
    let srcPointId = 'unknown';
    const startZone = this.worldEngine.getZoneAt(path[0].x, path[0].y);
    if (startZone) {
      if (startZone.type === 'floor' && startZone.name.toLowerCase().includes('road')) {
        srcPointId = `wp_road_${startZone.id}`;
      } else {
        srcPointId = `wp_${startZone.type}_${startZone.name.toLowerCase().replace(/\s+|\(|\)/g, '_').replace(/_+/g, '_')}`;
      }
    } else {
      // 如果没有找到区域，使用坐标作为起点标识
      srcPointId = `pos_${path[0].x}_${path[0].y}`;
    }

    // 执行路径中的每个点
    for (let i = 1; i < path.length; i++) {
      const nextPos = path[i];
      
      // 直接移动到目标坐标，而不是使用 moveTo 方法
      const player = this.worldEngine.getAllPlayers()[playerId];
      if (!player) break;

      // 计算需要移动的步数
      const dx = nextPos.x - player.x;
      const dy = nextPos.y - player.y;
      const stepsX = Math.abs(dx);
      const stepsY = Math.abs(dy);
      const totalSteps = Math.max(stepsX, stepsY);

      // 执行移动
      for (let step = 0; step < totalSteps; step++) {
        // 尝试移动到当前步骤的目标坐标
        let moved = false;
        
        // 尝试主要方向
        if (Math.abs(dx) > Math.abs(dy)) {
          // 先移动 X 方向
          const xDir = dx > 0 ? 'E' : 'W';
          const xResult = this.worldEngine.move(playerId, xDir, 1);
          if (!xResult.blocked) {
            moved = true;
          } else {
            // 如果 X 方向被阻塞，尝试 Y 方向
            const yDir = dy > 0 ? 'S' : 'N';
            const yResult = this.worldEngine.move(playerId, yDir, 1);
            if (!yResult.blocked) {
              moved = true;
            }
          }
        } else {
          // 先移动 Y 方向
          const yDir = dy > 0 ? 'S' : 'N';
          const yResult = this.worldEngine.move(playerId, yDir, 1);
          if (!yResult.blocked) {
            moved = true;
          } else {
            // 如果 Y 方向被阻塞，尝试 X 方向
            const xDir = dx > 0 ? 'E' : 'W';
            const xResult = this.worldEngine.move(playerId, xDir, 1);
            if (!xResult.blocked) {
              moved = true;
            }
          }
        }

        // 如果主要方向都被阻塞，尝试对角线方向
        if (!moved) {
          const directions = ['NE', 'NW', 'SE', 'SW'];
          for (const dir of directions) {
            const result = this.worldEngine.move(playerId, dir, 1);
            if (!result.blocked) {
              moved = true;
              break;
            }
          }
        }

        // 如果仍然被阻塞，标记为阻塞并退出
        if (!moved) {
          blocked = true;
          break;
        }

        actualSteps++;

        // 检查是否到达目标区域
        const updatedPlayer = this.worldEngine.getAllPlayers()[playerId];
        if (updatedPlayer) {
          // 如果有目标路标点 ID，检查是否到达了目标区域
          if (pointId) {
            // 获取当前区域
            const currentZone = this.worldEngine.getZoneAt(updatedPlayer.x, updatedPlayer.y);
            if (currentZone) {
              // 生成路标点 ID 并与目标路标点 ID 比较，与 path-planner.js 中的逻辑保持一致
              let currentPointId;
              if (currentZone.type === 'floor' && currentZone.name.toLowerCase().includes('road')) {
                currentPointId = `wp_road_${currentZone.id}`;
              } else {
                // 与 path-planner.js 中的逻辑完全一致
                currentPointId = `wp_${currentZone.type}_${currentZone.name.toLowerCase().replace(/\s+|\(|\)/g, '_').replace(/_+/g, '_')}`;
              }
              if (currentPointId === pointId) {
                // 输出简化日志
                console.log(`Navigate:${playerName}:${playerId}: ${srcPointId} -> ${pointId}, True`);
                return {
                  success: true,
                  actualSteps,
                  blocked: false,
                  currentPathIndex: i,
                  reachedTarget: true
                };
              }
            }
          } else {
            // 否则检查是否到达目标坐标
            if (this.isInTargetArea(updatedPlayer.x, updatedPlayer.y, targetPos.x, targetPos.y)) {
              // 输出简化日志
              console.log(`Navigate:${playerName}:${playerId}: ${srcPointId} -> ${pointId || 'target'}, True`);
              return {
                success: true,
                actualSteps,
                blocked: false,
                currentPathIndex: i,
                reachedTarget: true
              };
            }
          }
        }
      }

      if (blocked) break;
      currentPathIndex = i;
    }

    // 执行完所有路径点后，再次检查是否到达了目标区域
    let reachedTarget = false;
    if (pointId) {
      const player = this.worldEngine.getAllPlayers()[playerId];
      if (player) {
        const currentZone = this.worldEngine.getZoneAt(player.x, player.y);
        if (currentZone) {
          let currentPointId;
          if (currentZone.type === 'floor' && currentZone.name.toLowerCase().includes('road')) {
            currentPointId = `wp_road_${currentZone.id}`;
          } else {
            currentPointId = `wp_${currentZone.type}_${currentZone.name.toLowerCase().replace(/\s+|\(|\)/g, '_').replace(/_+/g, '_')}`;
          }
          reachedTarget = currentPointId === pointId;
        }
      }
    } else {
      // 对于没有目标路标点 ID 的情况，检查是否到达目标坐标
      const player = this.worldEngine.getAllPlayers()[playerId];
      if (player) {
        reachedTarget = this.isInTargetArea(player.x, player.y, targetPos.x, targetPos.y);
      }
    }

    // 输出简化日志
    const success = !blocked && reachedTarget;
    console.log(`Navigate:${playerName}:${playerId}: ${srcPointId} -> ${pointId || 'target'}, ${success ? 'True' : 'False'}`);

    return {
      success,
      actualSteps,
      blocked,
      currentPathIndex,
      reachedTarget
    };
  }

  // 移动到指定坐标
  moveTo(playerId, targetX, targetY) {
    const player = this.worldEngine.getAllPlayers()[playerId];
    if (!player) {
      return { blocked: true };
    }

    let blocked = false;
    let stepsTaken = 0;

    // 计算需要移动的方向和步数
    const dx = targetX - player.x;
    const dy = targetY - player.y;

    // 尝试主要方向移动
    const directions = [];
    if (dx > 0) directions.push('E');
    else if (dx < 0) directions.push('W');
    if (dy > 0) directions.push('S');
    else if (dy < 0) directions.push('N');

    // 尝试次要方向（对角线移动）
    const secondaryDirections = [];
    if (dx > 0 && dy > 0) secondaryDirections.push(['E', 'S']);
    else if (dx > 0 && dy < 0) secondaryDirections.push(['E', 'N']);
    else if (dx < 0 && dy > 0) secondaryDirections.push(['W', 'S']);
    else if (dx < 0 && dy < 0) secondaryDirections.push(['W', 'N']);

    // 尝试主要方向
    let moved = false;
    for (const direction of directions) {
      const steps = direction === 'E' || direction === 'W' ? Math.abs(dx) : Math.abs(dy);
      const result = this.worldEngine.move(playerId, direction, steps);
      if (!result.blocked) {
        stepsTaken += result.actualSteps;
        moved = true;
        break;
      }
    }

    // 如果主要方向被阻塞，尝试次要方向
    if (!moved && secondaryDirections.length > 0) {
      for (const dirs of secondaryDirections) {
        let tempBlocked = false;
        let tempSteps = 0;
        
        for (const direction of dirs) {
          const steps = direction === 'E' || direction === 'W' ? Math.abs(dx) : Math.abs(dy);
          const result = this.worldEngine.move(playerId, direction, steps);
          if (result.blocked) {
            tempBlocked = true;
            break;
          }
          tempSteps += result.actualSteps;
        }
        
        if (!tempBlocked) {
          stepsTaken = tempSteps;
          moved = true;
          break;
        }
      }
    }

    // 如果所有方向都被阻塞，尝试单步移动
    if (!moved) {
      const singleStepDirections = ['E', 'W', 'S', 'N'];
      for (const direction of singleStepDirections) {
        const result = this.worldEngine.move(playerId, direction, 1);
        if (!result.blocked) {
          stepsTaken = 1;
          moved = true;
          break;
        }
      }
    }

    return { blocked: !moved, stepsTaken };
  }

  // 检查是否在目标区域
  isInTargetArea(playerX, playerY, targetX, targetY) {
    // 定义目标区域为目标点周围1格的范围
    const distance = Math.sqrt(Math.pow(playerX - targetX, 2) + Math.pow(playerY - targetY, 2));
    return distance <= 1;
  }

  // 计算移动方向
  calculateDirections(path) {
    const directions = [];

    for (let i = 1; i < path.length; i++) {
      const current = path[i - 1];
      const next = path[i];
      const dx = next.x - current.x;
      const dy = next.y - current.y;

      if (dx > 0) directions.push('E');
      else if (dx < 0) directions.push('W');
      else if (dy > 0) directions.push('S');
      else if (dy < 0) directions.push('N');
    }

    return directions;
  }

  // 验证路径有效性
  validatePath(path) {
    if (!path || path.length < 2) {
      return false;
    }

    // 检查路径是否连续
    for (let i = 1; i < path.length; i++) {
      const current = path[i - 1];
      const next = path[i];
      const dx = Math.abs(next.x - current.x);
      const dy = Math.abs(next.y - current.y);

      // 路径点之间应该相邻
      if (dx > 1 || dy > 1 || (dx === 1 && dy === 1)) {
        return false;
      }
    }

    return true;
  }

  // 简化路径
  simplifyPath(path) {
    if (!path || path.length < 3) {
      return path;
    }

    const simplified = [path[0]];

    for (let i = 1; i < path.length - 1; i++) {
      const prev = path[i - 1];
      const current = path[i];
      const next = path[i + 1];

      // 检查是否在同一条直线上
      const dx1 = current.x - prev.x;
      const dy1 = current.y - prev.y;
      const dx2 = next.x - current.x;
      const dy2 = next.y - current.y;

      if (dx1 !== dx2 || dy1 !== dy2) {
        simplified.push(current);
      }
    }

    simplified.push(path[path.length - 1]);
    return simplified;
  }
}

module.exports = PathExecutor;