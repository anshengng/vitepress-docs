# equals 与 hashCode 的契约

## 题目

> 为什么重写 equals 必须重写 hashCode？不重写会怎样？hashCode 的契约规则有哪些？HashSet/HashMap 是怎么用这两个方法的？Lombok @Data 有什么坑？

## 为什么需要关注这个契约

`Object` 里这两个方法的默认实现都是"看身份、不看内容"：

```java
// Object 源码（默认实现）
public boolean equals(Object obj) { return (this == obj); }   // 比的是内存地址
public native int hashCode();  // 和对象身份绑定的本地方法（近似地址哈希）
```

而业务上我们几乎都按"内容相等"判断：两个 `User(id=1, name="张三")` 应该是同一个用户。
一旦你重写了 equals（按内容比），却忘了重写 hashCode，**HashMap / HashSet / Hashtable 这类哈希容器就会出错**——因为它们先用 hashCode 找位置，再用 equals 确认。

## 核心要点

### 契约规则（背下来）

1. **相等 → hash 必相等**：`a.equals(b) == true` ⇒ `a.hashCode() == b.hashCode()` 必须成立
2. **hash 相等 ≠ 对象相等**：hashCode 相同只是"可能同一个桶"，最后还要 equals 裁决（哈希冲突天然存在）
3. equals 满足自反、对称、传递、一致；对象参与哈希容器期间 hashCode 不能变（所以做 key 的字段最好是 final/不变量，String/Integer 都不可变）

### HashMap 查找流程：先 hash 定位桶，再 equals 比较

```
map.put(key, value) / map.get(key)

        key.hashCode() ──► hash 扰动 ──► (n-1) & hash
  ┌──────────────────────────────────────────────────────┐
  │ 桶数组 table                                          │
  │ [0] [1] [2] [3] ... [7] ... [15]                      │
  │              ▲                                        │
  └──────────────┼────────────────────────────────────────┤
                 │ 落到某个桶
                 ▼
        桶内节点链表/红黑树
        ┌─ e.hash == key.hash ? ─否→ 跳过（根本不看 equals）
        └─ 是 → e.key.equals(key) ? ─是→ 命中，返回 value
                                  ─否→ 继续比下一个节点
```

**equals 只在"同一个桶内"才被调用**。hashCode 不一致 = 连"进同一个门"的机会都没有。

### 模拟场景：只改 equals 不改 hashCode，put 后 get 返回 null

`User` 重写了 equals（按 id+name 比），hashCode 仍用 Object 默认：

```java
Map<User, String> map = new HashMap<>();
User k1 = new User(1, "张三");
map.put(k1, "VIP");
User k2 = new User(1, "张三");   // 内容相同，k1.equals(k2) == true
map.get(k2);                     // 期望 "VIP"，实际 null ❌
```

```
时刻  操作                  k1.hashCode()  k2.hashCode()  HashMap 内部
 t1   put(k1,"VIP")         17898797       -              hash(k1)=17898797 → 落桶 13，存入
 t2   k1.equals(k2)         -              -              true（内容相等）✅
 t3   get(k2)               -              902153912      hash(k2)=902153912 → 落桶 8
 t4                         -              -              桶 8 是空的 → 直接返回 null ❌
```

两个"逻辑相等"的对象被 hashCode 分到了**不同的桶**，equals 压根没机会出场。
（若碰巧落进同一桶反而能查到——所以这是**概率性 bug**，测试难复现，线上更毒。）

### String / Integer 是怎么重写的（正例）

```java
// String.hashCode()：s[0]*31^(n-1) + ... —— 纯由字符内容算出，内容同则 hash 同
// Integer.hashCode()：直接返回 value 本身
// 两者都同时重写了 equals + hashCode，契约完整
```

### 正确姿势：equals 和 hashCode 必须成对重写

```java
@Override public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof User)) return false;
    User u = (User) o;
    return id == u.id && Objects.equals(name, u.name);
}
@Override public int hashCode() {
    return Objects.hash(id, name);   // 参与 equals 的字段，全部参与 hashCode
}
```

口诀：**equals 用了哪些字段，hashCode 就用哪些字段**。

### IDE 生成 vs Lombok @Data 的坑

| 方式 | equals/hashCode | 注意点 |
| --- | --- | --- |
| `Object` 默认 | 都是身份比较 | 放进哈希容器按"地址"去重，业务内容相同也视为不同 |
| IDE 生成（成对勾选） | 按选定字段，成对生成 | 只勾 equals 不勾 hashCode 就会踩上面的坑 |
| Lombok `@Data` | 自动成对生成 | 默认含**所有非静态字段**；字段可变时改一下值 hash 就变，桶都找不回来 |
| `@EqualsAndHashCode` | 可 `of`/`exclude` 指定字段 | 做 Map key 的字段务必排除可变字段 |
| 继承场景 | `callSuper` 参数 | 子类 @Data 默认不含父类字段，可能"父类字段不同却相等" |

`@Data` 可变字段做 key 的翻车时间线：

```
t1  u = new User(1,"张三"); map.put(u,"VIP")   hash=桶13 ✅
t2  u.setName("李四")                            hashCode 变了
t3  map.get(u) → 按新 hash 找桶 5，桶 5 空 → null ❌（对象还躺在桶 13 里，remove 也删不掉 → 泄漏）
```

### HashSet 去重同理

HashSet 底层就是 HashMap（元素当 key，value 是哑对象 PRESENT）：

```
set.add(a) → set.add(b)   a.equals(b)==true 但 hash 不同 → 两个都进 set，去重失效（重复数据落库）
```

## 面试答法

### 30 秒版（可背诵口语）

> equals 和 hashCode 有个契约：两个对象 equals 相等，hashCode 必须相等，反过来不成立。哈希容器的查找是两步走——先用 hashCode 定位桶，再用 equals 在桶内确认。所以只重写 equals 不重写 hashCode 时，两个内容相等的对象会被分到不同桶，HashMap 里 put 完 get 直接返回 null，HashSet 里去重失效。正确做法是 equals 用了哪些字段，hashCode 就用哪些字段，IDE 生成或 Lombok 时要成对生成，而且可变字段不要参与哈希计算，否则对象放进 Map 后一改值就找不回来了。

### 深入版（被追问时按编号展开）

1. **默认实现**：Object.equals 比地址，Object.hashCode 是本地方法给的 identity hash，与内容无关
2. **容器机制**：画 HashMap put/get 流程——hash 扰动 + `(n-1)&hash` 定桶 → 桶内先比 hash 再 equals；强调 equals 只在同桶内被调用
3. **模拟翻车**：User 只改 equals，put(k1) 落桶 13，get(k2) 按默认 hash 落桶 8，返回 null；说明这是概率性 bug（碰巧同桶反而对）
4. **契约细节**：相等⇒hash 相等；hash 相等⇒不一定相等（冲突）；参与哈希的字段必须不可变，String/Integer 是标准正例
5. **工程坑**：@Data 全字段参与 + 可变字段导致"放进去改值后 get 不到、remove 不掉"；继承时 callSuper 漏父类字段
6. **收尾**：HashSet 去重同理，因为它就是 HashMap 套壳

### 常见追问

- **hashCode 相同、equals 不同会怎样？** → 正常哈希冲突，落同一桶用 equals 区分，功能不受影响，只是链表/树变长
- **为什么 String 重写了这两个方法？** → 内容语义 + 不可变，天然适合做 key，hash 还能缓存（`hashCode` 字段惰性计算）
- **可变对象做 Map key 有什么风险？** → 改值后 hashCode 变化，桶定位失败，条目"失踪"且无法 remove，等效内存泄漏
- **record 类型呢？** → record 自动按全部组件成对生成 equals/hashCode，是"内容相等"语义的最省事写法
- **Objects.hash 性能差在哪？** → 可变参数数组装箱，热点路径可手写 `31*result + field` 或用 `Long.hashCode` 组合
