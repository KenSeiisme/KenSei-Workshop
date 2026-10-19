// 以十进制 MB 计算请求负载，完整计划共 488.9 MB，重试同样计入 500 MB。
export const NETWORK_BUDGET = 500000000;
export const NETWORK_MEASUREMENTS = [
  { type: "latency", numPackets: 20 },
  ...[
    [100000, 5],
    [1000000, 4],
    [10000000, 4],
    [25000000, 4],
    [50000000, 3],
  ].map(([bytes, count]) => ({ type: "download", bytes, count })),
  ...[
    [100000, 4],
    [1000000, 4],
    [10000000, 4],
    [25000000, 4],
    [50000000, 1],
  ].map(([bytes, count]) => ({ type: "upload", bytes, count })),
];
