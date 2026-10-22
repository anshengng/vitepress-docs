# 前端手写算法模板：双指针、滑动窗口、二分、树与链表、DP、TopK

## 题目

> 前端面试算法常考哪几类？双指针、滑动窗口、二分查找、二叉树遍历、链表操作、动态规划入门题、TopK 各有什么可复用的模板？复杂度怎么当场说清楚？

## 为什么需要

前端面试的算法题 90% 集中在 easy~medium 的**模板题**，考察的不是智商而是三件事：能不能认出题型套对模板、边界条件处理是否严谨、能不能主动报复杂度。把下面 8 个模板练熟，绝大多数题都能归约：

```
识别信号 → 模板选择：

  有序数组 / 首尾逼近 / 原地移动   ──►  双指针
  连续子串/子数组 + 最值           ──►  滑动窗口
  有序 + 找位置/找边界             ──►  二分查找
  括号/嵌套匹配                   ──►  栈
  树形结构遍历/层序               ──►  递归 + 队列
  指针断裂/前驱未知               ──►  链表（dummy 哨兵）
  "最优/多少种方案" + 小例子可手推 ──►  动态规划
  第 K 大 / 前 K 个               ──►  快选 / 大小为 K 的堆
```

## 核心要点

### 1. 双指针

**对撞指针**（有序数组，两端向中间逼近）：

```
两数之和（升序版）nums=[2,7,11,15], target=9

  L→                       ←R     2+15=17 大于 9 → R 左移
  L→                 ←R           2+7=9  命中 → 返回下标

不变式：答案若存在，一定还在 [L, R] 区间内
```

```javascript
// 模板：对撞双指针——两数之和 II（输入有序数组）
function twoSumSorted(nums, target) {
  let l = 0, r = nums.length - 1
  while (l < r) {
    const sum = nums[l] + nums[r]
    if (sum === target) return [l, r]
    if (sum < target) l++   // 和偏小：左指针右移增大和
    else r--                // 和偏大：右指针左移减小和
  }
  return []
}
```

```javascript
// 模板：反转字符串（原地交换）
function reverseString(s) { // s 为字符数组
  let l = 0, r = s.length - 1
  while (l < r) {
    ;[s[l], s[r]] = [s[r], s[l]]
    l++
    r--
  }
  return s
}
```

**快慢指针**（链表，判断是否有环）：

```
1 → 2 → 3 → 4 → 5
            ↑       ↓      slow 走 1 步，fast 走 2 步
            ← ← ← ← ←      有环则 fast 必然"套圈"追上 slow

  第 1 步: slow=2, fast=3
  第 2 步: slow=3, fast=5
  第 3 步: slow=4, fast=3   ← 重合，有环
```

```javascript
// 模板：快慢指针——环形链表
function hasCycle(head) {
  let slow = head, fast = head
  while (fast !== null && fast.next !== null) { // 两个都要判空，顺序不能反
    slow = slow.next
    fast = fast.next.next
    if (slow === fast) return true // 相遇即有环
  }
  return false // fast 撞到 null，无环
}
```

| 指标 | 两数之和/反转 | 环形链表 |
| --- | --- | --- |
| 时间 | O(n) | O(n) |
| 空间 | O(1) | O(1) |

**坑点**：对撞指针的前提是**有序或单调**，无序数组用它会漏解；快慢指针的 while 条件必须 `fast && fast.next` 同时判（只判一个，偶数长度无环链表会在 `fast.next.next` 处崩）；追环入口还需第二阶段（相遇后 one 回头、两指针同速再走）。

### 2. 滑动窗口

**窗口移动图解**（无重复字符的最长子串，s = "abcabcbb"）：

```
窗口 [L, R]，R 只进不退，遇到重复字符 L 跳到"上次出现位置+1"

a b c a b c b b
[     ]           R=0..2  "abc" 长度 3
  [   ]           R=3 'a' 重复且 L=0 ≥ 旧位置0 → L 跳到 1，窗口 "bca"
    [   ]         R=4 → L=2，窗口 "cab"
      [   ]       R=5 → L=3，窗口 "abc"
        [ ]       R=6 → L=5，窗口 "cb"
         [ ]      R=7 → L=6，窗口 "b"
答案 = 过程中窗口最大宽度 = 3
```

```javascript
// 模板：滑动窗口——无重复字符的最长子串
function lengthOfLongestSubstring(s) {
  const seen = new Map() // 字符 -> 最近一次出现的下标
  let start = 0, max = 0
  for (let end = 0; end < s.length; end++) {
    const c = s[end]
    // 关键判断：重复位置必须落在当前窗口内才收缩
    if (seen.has(c) && seen.get(c) >= start) {
      start = seen.get(c) + 1 // L 直接"跳过"重复点，不用一步步挪
    }
    seen.set(c, end)
    max = Math.max(max, end - start + 1)
  }
  return max
}
```

| 指标 | 值 | 说明 |
| --- | --- | --- |
| 时间 | O(n) | R 全程只进不退，L 也只进不退，各移动至多 n 次 |
| 空间 | O(min(n, 字符集)) | Map 存窗口内字符 |

**坑点**：`seen.get(c) >= start` 这个判断不能少——窗口左边界外的旧记录（如 "abba" 场景）会把 start 往回拉，导致窗口错误；滑动窗口三步口诀"**扩 → 判 → 收**"，R 负责扩，命中答案更新在判，违例时 L 负责收。

### 3. 栈：有效括号

```javascript
// 模板：栈——有效括号
function isValid(s) {
  const pairs = { ')': '(', ']': '[', '}': '{' } // 右括号 → 对应左括号
  const stack = []
  for (const c of s) {
    if (c === '(' || c === '[' || c === '{') {
      stack.push(c)
    } else {
      // 栈空时 pop() 返回 undefined，必然与期望左括号不等 → 天然处理多余右括号
      if (stack.pop() !== pairs[c]) return false
    }
  }
  return stack.length === 0 // 处理完还有剩余 → 左括号多余，如 "((("
}
```

| 指标 | 值 |
| --- | --- |
| 时间 | O(n) |
| 空间 | O(n)（最坏全是左括号） |

**坑点**：最后必须判 `stack.length === 0`，漏掉这步 "((" 会被误判为合法；`pop()` 空栈返回 undefined 恰好不等于任何左括号，是刻意利用的语言特性，要能主动讲出来。

### 4. 二分查找（边界写法模板）

统一采用**左闭右开 `[l, r)`** 的 lowerBound 模板（第一个大于等于 target 的位置），它能衍生出几乎所有二分题：

```
nums=[1,3,5,6,8]，target=6，搜索插入位置

l=0                r=5（开区间，r 可指向"答案位"）
      m=2(5<6)  → l=3     左半部分全部排除
   m=4(8≥6)    → r=4      8 自己仍是候选，r 收到 m
 m=3(6≥6)     → r=3       命中候选
l === r → 收敛，答案 = 3

不变式：答案永远落在 [l, r]，循环结束 l 即第一个 ≥ target 的下标
```

```javascript
// 模板：lowerBound——第一个 >= target 的下标（不存在则返回 nums.length）
function lowerBound(nums, target) {
  let l = 0, r = nums.length      // 左闭右开 [l, r)
  while (l < r) {                 // 区间非空就继续
    const m = (l + r) >> 1
    if (nums[m] < target) l = m + 1 // m 已排除，+1 收缩
    else r = m                      // m 仍是候选，收到 m（不能 -1）
  }
  return l
}

// 用它解"搜索插入位置"：
const searchInsert = (nums, target) => lowerBound(nums, target)

// 变体：upperBound（第一个 > target）只需把条件改成 <=
// 变体：精确查找：lowerBound 结果处再比一次相等
```

| 指标 | 值 |
| --- | --- |
| 时间 | O(log n) |
| 空间 | O(1) |

**坑点**：三件套必须**风格一致**——`[l, r)` 配 `while (l < r)` 配 `r = m`；写成 `r = nums.length - 1` 就要配 `while (l <= r)` 配 `r = m - 1`，混搭必死循环或漏边界；`l = m + 1` 忘了 +1 是死循环的头号原因；JS 里 `(l + r) >> 1` 不会溢出（双精度可精确表示到 2 的 53 次方），但面试官若问 C++ 要答 `l + ((r - l) >> 1)`。

### 5. 二叉树遍历（前中后 + 层序，递归与迭代）

```
            1
           / \
          2   3
         / \   \
        4   5   6

前序（根左右）：1 2 4 5 3 6
中序（左根右）：4 2 5 1 3 6
后序（左右根）：4 5 2 6 3 1
层序（BFS）  ：1 → 2 3 → 4 5 6
```

```javascript
// 递归模板：push 语句的位置决定遍历顺序，三序只差这一行放哪
function preorder(root, res = []) {
  if (!root) return res
  res.push(root.val)        // 前序：进节点就记录
  preorder(root.left, res)
  // preorder(root.right, res) 中序：把 push 挪到这两行之间
  preorder(root.right, res)
  return res
}
```

```javascript
// 迭代·前序：显式栈，先压右再压左（这样先弹出左）
function preorderIter(root) {
  if (!root) return []
  const stack = [root], res = []
  while (stack.length) {
    const node = stack.pop()
    res.push(node.val)
    if (node.right) stack.push(node.right)
    if (node.left) stack.push(node.left)
  }
  return res
}

// 迭代·中序：一路向左压栈，弹出即访问，然后转向右子树
function inorderIter(root) {
  const stack = [], res = []
  let cur = root
  while (cur !== null || stack.length) {
    while (cur !== null) { stack.push(cur); cur = cur.left }
    cur = stack.pop()
    res.push(cur.val)
    cur = cur.right
  }
  return res
}
// 迭代·后序技巧：按"根右左"前序遍历，最后 reverse 即得"左右根"
```

```javascript
// 层序遍历：队列 + 每轮固定 size 分层
function levelOrder(root) {
  if (!root) return []
  const queue = [root], levels = []
  while (queue.length) {
    const size = queue.length // 先锁定本层节点数
    const level = []
    for (let i = 0; i < size; i++) {
      const node = queue.shift()
      level.push(node.val)
      if (node.left) queue.push(node.left)
      if (node.right) queue.push(node.right)
    }
    levels.push(level)
  }
  return levels
}
```

| 遍历 | 时间 | 空间 |
| --- | --- | --- |
| 前/中/后（递归） | O(n) | O(h) 调用栈，h 为树高，最坏退化成 O(n) |
| 前/中/后（迭代） | O(n) | O(h) 显式栈 |
| 层序 BFS | O(n) | O(最大层宽)，满二叉树约 O(n/2) |

**坑点**：`size = queue.length` 必须在 for 之前锁定，否则边出队边入队层就乱了；数组 `shift()` 是 O(n)，大数据量用"头尾指针模拟队列"或真正的双向链表；递归深树爆栈要会主动说"可改显式栈迭代"。

### 6. 链表（反转 + 合并有序链表）

**反转链表指针移动图解**：

```
初始:   null   1 → 2 → 3 → null
        prev   cur

第1步:  保存 next(=2)；1 的 next 指向 prev(null)；prev、cur 整体右移
        null ← 1    2 → 3 → null
             prev   cur

第2步:  同法翻转 2
        null ← 1 ← 2    3 → null
                  prev   cur

第3步:  同法翻转 3，cur 到 null 结束，prev 即新头
        null ← 1 ← 2 ← 3
                       prev
```

```javascript
// 模板：反转链表
function reverseList(head) {
  let prev = null, cur = head
  while (cur !== null) {
    const next = cur.next // ① 先保存将被切断的后续
    cur.next = prev       // ② 反转指针
    prev = cur            // ③ prev 前进
    cur = next            // ④ cur 前进
  }
  return prev // prev 停在最后一个节点，即新头
}
```

```javascript
// 模板：合并两个有序链表（dummy 哨兵简化头节点特判）
function mergeTwoLists(a, b) {
  const dummy = { next: null } // 哨兵：省去"头节点是谁"的判断
  let tail = dummy
  while (a !== null && b !== null) {
    if (a.val <= b.val) { tail.next = a; a = a.next } // 取等号保证稳定
    else { tail.next = b; b = b.next }
    tail = tail.next
  }
  tail.next = a !== null ? a : b // 剩余部分整段挂上即可
  return dummy.next
}
```

| 操作 | 时间 | 空间 |
| --- | --- | --- |
| 反转 | O(n) | O(1)（递归写法为 O(n) 栈） |
| 合并 | O(m + n) | O(1) |

**坑点**：反转必须先存 `next` 再改指向，顺序反了链表当场断裂；`return prev` 不是 `return cur`（循环结束时 cur 是 null）；dummy 哨兵是链表题的通用技巧，所有"可能改变头节点"的题（删除、合并、分隔）都该用。

### 7. 动态规划入门（爬楼梯 + 最大子数组和）

DP 答题三步：**定义状态 → 写转移方程 → 定初始值/边界**。

```
爬楼梯：到第 n 级 = 从 n-1 迈一步 + 从 n-2 迈两步
        f(n) = f(n-1) + f(n-2)，f(1)=1, f(2)=2
        本质就是斐波那契，滚动变量把空间从 O(n) 压到 O(1)
```

```javascript
// 模板：爬楼梯
function climbStairs(n) {
  let a = 1, b = 1 // f(0)=1（不动也是一种走法）, f(1)=1
  for (let i = 2; i <= n; i++) {
    ;[a, b] = [b, a + b] // 滚动更新，等价 dp[i] = dp[i-1] + dp[i-2]
  }
  return b
}
```

```
最大子数组和（Kadane）：cur 表示"以当前元素结尾的最大和"
要么延续前段，要么从自己重新开始——前段是负资产就丢弃

元素:  -2   1  -3   4  -1   2   1  -5   4
cur :  -2   1  -2   4   3   5   6   1   5
best:  -2   1   1   4   4   5   6   6   6   ← 答案 6（子数组 [4,-1,2,1]）
```

```javascript
// 模板：最大子数组和（Kadane）
function maxSubArray(nums) {
  let cur = nums[0], best = nums[0]
  for (let i = 1; i < nums.length; i++) {
    cur = Math.max(nums[i], cur + nums[i]) // 延续 or 重开，取大
    best = Math.max(best, cur)             // 全局最优在每步 cur 里挑
  }
  return best
}
```

| 题目 | 时间 | 空间 | 压缩后空间 |
| --- | --- | --- | --- |
| 爬楼梯 | O(n) | O(n) 的 dp 表 | O(1) 滚动变量 |
| 最大子数组和 | O(n) | O(n) | O(1) |

**坑点**：Kadane 的 `best` 和 `cur` 是两个维度——cur 是"以 i 结尾"，best 是全局，只更新一个必错；全负数组时初始值必须取 `nums[0]` 而不是 0，否则答案错报 0；爬楼梯 n=1 的边界要能被循环自然覆盖。

### 8. TopK（快选 + 小顶堆思路）

```
快选：partition 后 pivot 落在"最终排序位" p，只递归答案所在的一侧

nums=[3,2,1,5,6,4], k=2（第 2 大 → 升序下标 4）
一次划分: [2 1 3 5 6 4]，pivot=3 落定在 p=2
p < 4 → 答案在右半，左半整段扔掉（这就是它比全排序快的原因）
继续划分直到 p === 4
```

```javascript
// 模板：快速选择——第 K 大，平均 O(n)，原地
function findKthLargest(nums, k) {
  const target = nums.length - k // 第 k 大 = 升序排列后下标 target
  let lo = 0, hi = nums.length - 1
  while (lo < hi) {
    const p = partition(nums, lo, hi)
    if (p === target) return nums[p]
    if (p < target) lo = p + 1
    else hi = p - 1
  }
  return nums[lo]
}

function partition(nums, lo, hi) {
  // 随机选 pivot 并换到末尾：防止有序输入退化 O(n^2)
  const rand = lo + Math.floor(Math.random() * (hi - lo + 1))
  ;[nums[rand], nums[hi]] = [nums[hi], nums[rand]]
  const pivot = nums[hi]
  let i = lo
  for (let j = lo; j < hi; j++) {
    if (nums[j] < pivot) {
      ;[nums[i], nums[j]] = [nums[j], nums[i]]
      i++
    }
  }
  ;[nums[i], nums[hi]] = [nums[hi], nums[i]]
  return i
}
```

**小顶堆思路**（维护大小为 k 的堆）：遍历数组，元素入堆；堆超过 k 就弹堆顶（当前 k 个里最小的）；遍历完堆顶即第 k 大。适合**数据流 / 内存装不下**的场景——任何时刻内存里只有 k 个元素。

| 方案 | 时间 | 空间 | 适用场景 |
| --- | --- | --- | --- |
| 直接排序取第 k 个 | O(n log n) | O(log n) | 最快说出，作为基准 |
| 快选 | 平均 O(n)，最坏 O(n²)（随机 pivot 规避） | O(1) | 一次性数据、内存够 |
| 大小为 k 的小顶堆 | O(n log k) | O(k) | 数据流、海量数据 |

**坑点**：快选会**打乱原数组**，题目要求不可变先拷贝；求"前 k 大"用**小**顶堆（堆顶是 k 个里最弱的，随时被替换），方向别说反；`k` 与"下标 target"的换算（`n - k`）是现场最容易写错的一步。

## 面试答法

### 30 秒版本

> 算法题的应答流程五步：**复述题目并确认边界**（空输入？有序？可否原地改）→ **先报暴力解和它的复杂度**，证明你从朴素出发 → **说出优化思路的模板名**（"这是滑动窗口，R 只进不退所以 O(n)"）→ **写码时边写边讲不变式**（"循环里答案始终在 [l, r] 内"）→ **写完主动用一个样例走一遍 + 报时间空间复杂度**。识别模板靠信号词：连续子串最值想滑窗，有序找边界想二分，第 K 大想快选或堆。

### 深入展开

1. **双指针**：对撞靠单调性收缩（`l < r`），快慢靠套圈判环（`fast && fast.next` 双判空）
2. **滑动窗口**：扩 → 判 → 收；用 Map 记位置实现 L 直接跳跃，`seen.get(c) >= start` 防旧记录回拉
3. **栈**：pop 空栈返回 undefined 天然判不匹配；收尾必须验证栈空
4. **二分**：背死一个模板（左闭右开 + `while (l < r)` + `r = m`），其余变体现场推导；三件套风格一致是铁律
5. **二叉树**：递归版三序只差 push 位置；迭代前序"先压右"，中序"一路向左"，后序"前序反转"；BFS 先锁 size 再分层
6. **链表**：反转四步"存改移移"，返回 prev；一切可能动头节点的题先写 dummy
7. **DP**：状态定义 → 转移方程 → 初始值；Kadane 的 cur 是"以 i 结尾"、best 是全局
8. **TopK**：先说排序 O(n log n) 作基准，再优化到快选平均 O(n)，海量数据场景主动提大小为 k 的小顶堆

### 常见追问

- **为什么前端也考算法？** → 业务里真实用到：虚拟列表的窗口计算就是滑动窗口，diff 算法是双指针 + 映射表，搜索联想/区间查询用二分，表达式解析和括号匹配用栈；同时它是低成本考察编码规范、边界意识和复杂度敏感度的方式。
- **快选最坏为什么是 O(n²)？怎么避免？** → 每次 pivot 恰好选到极值时区间只缩小 1；随机 pivot（或三数取中）把期望复杂度拉回 O(n)。
- **滑动窗口为什么用 Map 不用 Set？** → Set 只能判存在，Map 记录**最近位置**，L 才能一步跳到重复点之后；用 Set 则 L 要逐格挪，仍是 O(n) 但常数更大。
- **二分 `while (l < r)` 和 `while (l <= r)` 有什么区别？** → 对应两种区间定义：`[l, r)` 非空条件是 `l < r`，`[l, r]` 是 `l <= r`；混用会死循环或漏查，选定一种写到底。
- **递归爆栈怎么办？** → JS 引擎不做尾调用优化，深树/长链表递归要改显式栈迭代；面试主动提出这一点是加分项。
- **TopK 数据是每秒百万的日志流，做不了全量排序怎么办？** → 大小为 k 的小顶堆，内存 O(k)、每元素 O(log k)；再大就分片各自取 TopK 再归并。
- **层序遍历用 `queue.shift()` 有什么问题？** → 数组 shift 是 O(n)，整体退化 O(n²)；用头指针模拟出队，或换真正的链表/双端队列结构。
- **Kadane 算法能顺便给出子数组的起止下标吗？** → 能：cur 重开（取 `nums[i]`）时记录候选起点，best 刷新时同步记录终点。
- **合并有序链表为什么比较用 `<=`？** → 相等时优先取 a 的节点，保证归并的**稳定性**（相同 key 保持原相对顺序）。
