const fs = require('fs');
const MapGraph = require('./map-graph');

class PathPlanner {
  constructor(mapPath, collisionMap, worldMap) {
    this.mapPath = mapPath;
    this.collisionMap = collisionMap;
    this.worldMap = worldMap;
    this.waypoints = [];
    this.waypointMap = {};
    this.mapGraph = new MapGraph();
    this.initialize();
  }

  // 初始化路径规划器
  initialize() {
    this.extractWaypoints();
    this.buildGraph();
    console.log(`🗺️ 路径规划系统初始化完成，路标点数量: ${this.waypoints.length}，图节点数: ${this.mapGraph.getNodeCount()}`);
  }

  // 从 map.tmj 提取路标点
  extractWaypoints() {
    const mapData = JSON.parse(fs.readFileSync(this.mapPath, 'utf8'));
    const semanticLayer = mapData.layers.find(layer => layer.name === 'SemanticZones');
    
    if (semanticLayer && semanticLayer.objects) {
      semanticLayer.objects.forEach(object => {
        // 提取建筑和地标
        if (object.type === 'building' || object.type === 'landmark' || object.type === 'nature') {
          const waypoint = {
            id: `wp_${object.type}_${object.name.toLowerCase().replace(/\s+|\(|\)/g, '_').replace(/_+/g, '_')}`,
            name: object.name,
            x: Math.floor((object.x + object.width / 2) / mapData.tilewidth),
            y: Math.floor((object.y + object.height / 2) / mapData.tileheight),
            type: object.type
          };
          this.waypoints.push(waypoint);
          this.waypointMap[waypoint.id] = waypoint;
        }
        // 提取道路
        else if (object.type === 'floor' && object.name.toLowerCase().includes('road')) {
          const waypoint = {
            id: `wp_road_${object.id}`,
            name: object.name,
            x: Math.floor((object.x + object.width / 2) / mapData.tilewidth),
            y: Math.floor((object.y + object.height / 2) / mapData.tileheight),
            type: 'road'
          };
          this.waypoints.push(waypoint);
          this.waypointMap[waypoint.id] = waypoint;
        }
      });
    }
  }

  // 构建图结构
  buildGraph() {
    this.mapGraph.buildGraph(this.waypoints);
  }

  // 找到最近的路标点
  findNearestWaypoint(x, y) {
    if (this.waypoints.length === 0) {
      return null;
    }

    let nearest = null;
    let minDistance = Infinity;

    for (const waypoint of this.waypoints) {
      const distance = Math.sqrt(Math.pow(waypoint.x - x, 2) + Math.pow(waypoint.y - y, 2));
      if (distance < minDistance) {
        minDistance = distance;
        nearest = waypoint;
      }
    }

    return nearest;
  }

  // 寻找最短路径
  findPath(startX, startY, targetX, targetY) {
    // 找到最近的路标点
    const startWaypoint = this.findNearestWaypoint(startX, startY);
    const targetWaypoint = this.findNearestWaypoint(targetX, targetY);

    if (!startWaypoint || !targetWaypoint) {
      return null;
    }

    // 使用 MapGraph 计算最短路径
    const pathIds = this.mapGraph.getShortestPath(startWaypoint.id, targetWaypoint.id);
    if (!pathIds) {
      // 如果找不到路径，尝试直接返回目标坐标
      return [{ x: startX, y: startY }, { x: targetX, y: targetY }];
    }

    // 转换为坐标路径
    const path = pathIds.map(nodeId => {
      const waypoint = this.waypointMap[nodeId];
      return waypoint ? { x: waypoint.x, y: waypoint.y } : null;
    }).filter(Boolean);

    // 在路径开始添加起点坐标，在结束添加终点坐标
    const fullPath = [{ x: startX, y: startY }, ...path, { x: targetX, y: targetY }];

    return fullPath;
  }

  // 获取所有路标点
  getWaypoints() {
    return this.waypoints;
  }

  // 根据 ID 获取路标点
  getWaypointById(id) {
    return this.waypointMap[id];
  }

  // 重新初始化（当地图变化时）
  rebuild() {
    this.waypoints = [];
    this.waypointMap = {};
    this.initialize();
  }
}

module.exports = PathPlanner;