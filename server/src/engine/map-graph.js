const Graph = require('graphology');
const { dijkstra } = require('graphology-shortest-path');

class MapGraph {
  constructor() {
    this.graph = new Graph();
  }

  // 添加节点
  addNode(id, properties) {
    if (!this.graph.hasNode(id)) {
      this.graph.addNode(id, properties);
    }
  }

  // 添加边
  addEdge(source, target, weight) {
    const edgeId = `${source}->${target}`;
    if (!this.graph.hasEdge(edgeId)) {
      this.graph.addEdgeWithKey(edgeId, source, target, { cost: weight });
    }
  }

  // 构建图结构
  buildGraph(waypoints) {
    // 清空现有图
    this.graph.clear();

    // 添加节点
    waypoints.forEach(waypoint => {
      this.addNode(waypoint.id, waypoint);
    });

    // 添加边
    for (let i = 0; i < waypoints.length; i++) {
      const wp1 = waypoints[i];
      for (let j = i + 1; j < waypoints.length; j++) {
        const wp2 = waypoints[j];
        const distance = Math.sqrt(Math.pow(wp1.x - wp2.x, 2) + Math.pow(wp1.y - wp2.y, 2));
        
        if (distance <= 20) { // 增加最大连接距离，确保更多路标点之间有连接
          this.addEdge(wp1.id, wp2.id, distance);
          this.addEdge(wp2.id, wp1.id, distance); // 添加双向边
        }
      }
    }
  }

  // 计算最短路径
  getShortestPath(startId, endId) {
    try {
      return dijkstra.bidirectional(this.graph, startId, endId, 'cost');
    } catch (error) {
      console.error('路径计算失败:', error);
      return null;
    }
  }

  // 获取图节点数量
  getNodeCount() {
    return this.graph.order;
  }

  // 获取图边数量
  getEdgeCount() {
    return this.graph.size;
  }

  // 检查节点是否存在
  hasNode(id) {
    return this.graph.hasNode(id);
  }

  // 获取节点属性
  getNodeProperties(id) {
    return this.graph.getNodeAttributes(id);
  }
}

module.exports = MapGraph;