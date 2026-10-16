# ArrayList 与 LinkedList、集合框架速览

## 题目

> ArrayList 和 LinkedList 的区别？ArrayList 扩容机制？分别什么场景用哪个？fail-fast 是什么？Arrays.asList 有什么坑？

## 为什么需要

先看全景——集合框架就两棵树（Map 单独一棵）：

```
                    Iterable
                        │
                   Collection
        ┌───────────┬────┴────┬─────────────┐
       List        Set       Queue        Deque
        │           │          │             │
  ArrayList      HashSet   LinkedList   LinkedList/ArrayDeque
  LinkedList   TreeSet     PriorityQueue  （既当栈又当队列）
  Vector       LinkedHashSet
  （Stack 古老，建议 ArrayDeque 替代）

  Map（不属于 Collection）
   ├── HashMap / LinkedHashMap / TreeMap
   └── Hashtable（古老）→ ConcurrentHashMap
```

面试 90% 考 List，重点就是 ArrayList vs LinkedList。

## 核心要点

### ArrayList 底层：动态数组 + 1.5 倍扩容

```
new ArrayList() → 初始是空数组 {}（懒加载）
第一次 add：
  ① 计算新容量 = 10（默认首次容量）
  ② elementData = Arrays.copyOf(旧数组, 新容量)

第 11 个元素放不下：
  新容量 = 旧容量 + (旧容量 >> 1)   ← 1.5 倍
  10 → 15 → 22 → 33 ...

add(e) 时间线：
  size=10，数组已满
  ├── 检查容量：size+1 > 10？是 → grow()
  │     └── newCap = 10 + 5 = 15
  │     └── Arrays.copyOf 拷贝到新数组（O(n) 一次性成本）
  └── elementData[10] = e; size = 11
```

**为什么不一次到位 / 不每次 +1？** 1.5 倍是"扩容频率"和"空间浪费"的折中（均摊后 add 仍是 O(1)）；想避免扩容就 `new ArrayList<>(expectedSize)` 提前给容量。

### 两种结构、两种操作成本

```
ArrayList（数组，连续内存）          LinkedList（双向链表）

 [0][1][2][3][4][5]                 head ⇄ [A] ⇄ [B] ⇄ [C] ⇄ tail
  ↑                                  每个 node: prev | item | next
  随机访问 get(3)：一步到位 O(1)

随机访问：get(i) 直接算地址 → O(1)    get(i) 从头/尾走到 i → O(n)
中间插入：后半段整体后移 → O(n)        插入：只改两个指针 → O(1)*
                                        * 但先要"走到位置"，所以整体仍 O(n)

删 index=2（共5个元素）对比：
ArrayList:  [A][B][C][D][E]  → [B] 删掉后 [D][E] 整体前移一格
                          [A][B]┄┄► [D][E]  移动 2 个

LinkedList: prev ⇄ [A] ⇄ [B] ⇄ [C] ⇄ next   → 只把 A.next 指向 C，C.prev 指向 A
            A ────────────────► C
                 （B 孤立，等 GC）           移动 0 个（但定位 O(n)）
```

### LinkedList 当队列 / 栈

```java
// 当队列（FIFO）
queue.offer(e);     // 入队尾 addLast
queue.poll();       // 出队头 removeFirst
// 当栈（LIFO，推荐用 ArrayDeque 替代）
stack.push(e);      // = addFirst
stack.pop();        // = removeFirst
```

### fail-fast：并发修改异常

```java
List<String> list = new ArrayList<>(List.of("a","b","c"));
for (String s : list) {
    if ("b".equals(s)) list.remove(s);  // 💥 ConcurrentModificationException
}
```

原理：迭代器创建时记下 `expectedModCount = modCount`；**只有迭代器自己的 remove 会同步两个计数**。直接调 `list.remove` 只改 modCount，下次 `next()` 检查 `modCount != expectedModCount` 就抛异常。

```
迭代器 next() 时：
  modCount(被外部改了=3) ≠ expectedModCount(迭代器记的=2) → 抛 CME
迭代器自己 remove：内部 modCount = expectedModCount 同步更新 → 安全
```

正确做法：用 `iterator.remove()`，或并发场景用 `CopyOnWriteArrayList`（写时复制新数组，读完全无锁）。

### Arrays.asList 的三个坑

1. 返回的是**定长**的内部类，`add/remove` 抛 UnsupportedOperationException（数组不能长）
2. 它**直接引用原数组**，改数组元素会互相影响
3. 传基本类型数组 `Arrays.asList(int[])` 会把整个数组当**一个**元素（泛型吃不下 int，要 `Integer[]`）

### 选型表

| 场景 | 选择 | 原因 |
| --- | --- | --- |
| 绝大多数场景 | **ArrayList** | CPU 缓存友好、随机访问快、扩容均摊后不慢 |
| 尾部频繁增删 | ArrayList | 尾部操作 O(1) |
| 当队列/栈 | ArrayDeque | 数组双端队列，比 LinkedList 快且省内存 |
| 随机访问为零、纯头尾操作 | LinkedList 也可以 | 指针改一改就行 |

**结论一句话：不确定就用 ArrayList，LinkedList 的理论优势在实践里几乎赢不了**（内存不连续、每次 new Node 开销大）。

## 面试答法

### 30 秒版（可背诵）

> ArrayList 底层是动态数组，默认首次扩容到 10，之后 1.5 倍扩容，通过 Arrays.copyOf 拷贝，支持随机访问 O(1)，中间插入删除要整体挪数据是 O(n)。LinkedList 是双向链表，插入删除只改指针，但定位要先遍历，所以实际用下来并不比 ArrayList 快多少。它还能当队列和栈用，不过当栈建议用 ArrayDeque。遍历时直接调 list.remove 会触发 fail-fast 抛并发修改异常，因为 modCount 和迭代器记录的不一致，要用迭代器的 remove。绝大多数场景直接用 ArrayList 就对了。

### 深入版（被追问时按编号展开）

1. **先给全景**：Collection 三大子接口 + Map 单独一棵树的图
2. **ArrayList**：数组结构图 + 1.5 倍扩容时间线 + 为什么均摊 O(1)
3. **对比**：随机访问 vs 指针改动的两组图解；强调 LinkedList 的 O(1) 只是"挂接"是 O(1)，定位仍是 O(n)
4. **fail-fast**：modCount 机制图解 + 三种正确姿势（iterator.remove / removeIf / COW）
5. **收尾**：选型表 + "不确定就 ArrayList"

### 常见追问

- **ArrayList 线程安全吗？** → 不安全；多线程用 CopyOnWriteArrayList（读多写少）或 `Collections.synchronizedList`
- **为什么是 1.5 倍不是 2 倍？** → 均摊扩容成本和内存浪费的折中，还能通过位运算算容量
- **删除元素时用 for i-- 还是迭代器？** → i-- 有坑（连续相等元素会漏删），推荐迭代器 remove 或 removeIf
- **ArrayDeque 为什么比 Stack 快？** → Stack 继承 Vector 全方法加锁，且是老设计；ArrayDeque 无锁、数组实现更缓存友好
