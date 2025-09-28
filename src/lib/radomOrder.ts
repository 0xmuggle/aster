import { User } from "./types";

let usedPairs = new Map(); // 记录已出现的账户对
let weights = new Map();
// 随机打乱数组
function shuffle(array: any) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// 检查一组是否有效（不包含已出现的账户对）
function isValidGroup(group: any) {
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const pair = [group[i].name, group[j].name].sort().join('-');
      if (usedPairs.get(group[i].name).has(group[j].name)) {
        return false;
      }
    }
  }
  return true;
}

// 更新权重和已配对记录
function updateWeightsAndPairs(group: any) {
  // 更新权重
  if (group.length === 2) {
    weights.set(group[0].name, weights.get(group[0].name) + 1);
    weights.set(group[1].name, weights.get(group[1].name) + 1);
  } else if (group.length === 3) {
    weights.set(group[0].name, weights.get(group[0].name) + 1); // 首账户权重+1
    weights.set(group[1].name, weights.get(group[1].name) + 0.5); // 非首账户权重+0.5
    weights.set(group[2].name, weights.get(group[2].name) + 0.5); // 非首账户权重+0.5
  }

  // 更新已配对记录
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      usedPairs.get(group[i].name).add(group[j].name);
      usedPairs.get(group[j].name).add(group[i].name);
    }
  }
}

// 生成随机分组
export function generateGroups(accounts: User[]) {
  // 输入账户数据
  // const accounts = Array.from({ length: 40 }, (_, i) => ({ name: `cc${i + 1}` }));

  // 跟踪每个账户的权重和已配对的账户对
  weights = new Map(accounts.map(acc => [acc.name, 0])); // 每个账户的权重
  usedPairs = new Map(); // 记录已出现的账户对
  accounts.forEach(acc => usedPairs.set(acc.name, new Set()));

  const groups = [];
  const availableAccounts = [...accounts];
  let i = 0;
  while (availableAccounts.length >= 2 && i < 100000) {
    i++;
    // 按权重排序，优先选择权重最低的账户
    availableAccounts.sort((a, b) => weights.get(a.name) - weights.get(b.name));

    // 如果权重最低的账户已达到15，检查是否所有账户都满足要求
    if (weights.get(availableAccounts[0].name) >= 8) {
      if (availableAccounts.every(acc => weights.get(acc.name) >= 6)) {
        break; // 所有账户权重满足13-15，退出
      }
    }

    // 随机决定组大小（2或3）
    const groupSize = 3;

    // 尝试形成一组
    let group = null;
    const shuffled = shuffle([...availableAccounts]);
    for (let i = 0; i < shuffled.length; i++) {
      const candidate = [shuffled[i]];
      const remaining = shuffled.filter((_: any, idx: any) => idx !== i);

      // 从剩余账户中随机选择groupSize-1个
      const partners = shuffle([...remaining]).slice(0, groupSize - 1);
      const potentialGroup = [...candidate, ...partners];

      if (potentialGroup.length === groupSize && isValidGroup(potentialGroup)) {
        group = potentialGroup;
        break;
      }
    }

    if (group) {
      // 格式化输出
      const groupObj = {
        primaryAccount: group[0].name,
        hedgeAccount: group[1] ? group[1].name : '',
        hedgeAccount2: group[2] ? group[2].name : '',
      };
      groups.push(groupObj);
      updateWeightsAndPairs(group);

      // 移除权重已达15的账户
      group.forEach(acc => {
        if (weights.get(acc.name) >= 15) {
          const index = availableAccounts.findIndex(a => a.name === acc.name);
          if (index !== -1) availableAccounts.splice(index, 1);
        }
      });
    } else {
      // 如果无法形成有效组，尝试减少组大小或退出
      if (groupSize === 3) continue; // 尝试2人组
      break; // 无法继续分组
    }
  }

  return groups;
}
