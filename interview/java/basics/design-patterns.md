# 高频设计模式：工厂、策略、观察者（含 if-else 重构）

## 题目

> 六大设计原则是什么？工厂/策略/观察者模式能手写吗？Spring 和 JDK 里哪些地方用到了这些模式？如何用策略模式重构一堆 if-else？模式之间怎么选型？

## 为什么需要

设计模式是面向对象工程实践沉淀出的"标准件"，对付的是同一个敌人——**变化**。没有模式，改需求是"牵一发动全身"；有了模式，改需求是"插一个新零件"。

```
不用模式（耦合）：
  调用方 ──new──► 具体类A          要加渠道B？改调用方代码 + 全量回归
  计费：if(ali){...} else if(wx){...} else if(...){...} × 20 个分支，没人敢动

用模式（面向抽象编程）：
  调用方 ──依赖──► 接口 ◄──实现── A / B / C / 新增D
  加一个类型 = 加一个类，老代码一行不动（开闭原则落地）
```

## 核心要点

### 一、六大原则（前置速览表）

| 原则 | 一句话 | 典型反例 |
| --- | --- | --- |
| 单一职责 SRP | 一个类只干一件事 | 上帝类：订单服务里又发短信又做报表 |
| 开闭原则 OCP | 对扩展开放、对修改关闭 | 加个分支要改老方法、回归全部逻辑 |
| 里氏替换 LSP | 子类替换父类不破坏原行为 | 子类重写方法直接抛 UnsupportedOperation |
| 依赖倒置 DIP | 依赖抽象，不依赖具体实现 | 业务代码里直接 new 具体类 |
| 接口隔离 ISP | 多个小接口优于一个大胖接口 | 一个接口 30 个方法，实现被迫空实现 |
| 迪米特法则 LoD | 只跟直接朋友通信 | a.getB().getC().getD() 链式火车 |

工厂、策略、观察者本质上都是 **OCP + DIP** 的落地手段。

### 二、工厂模式

**意图**：把"new"集中到一处，调用方只认产品接口、不认具体类。

```
        ┌─────────────────────┐
        │   <<interface>>     │
        │      Product        │ ◄── 调用方只依赖这一层
        └───▲──────▲──────▲───┘
            │      │      │
   ┌────────┴┐ ┌───┴────┐ ┴────────┐
   │ProductA │ │ProductB│ │ProductC│     都被 ↓ 创建
   └─────────┘ └────────┘ └────────┘
        ┌──────────────────────────────┐
        │  Factory.create(type)        │ ◄── 唯一知道所有具体类的地方
        └──────────────────────────────┘
```

```java
public interface PayChannel { void pay(long amount); }

public class AliPayChannel implements PayChannel {
    public void pay(long amount) { /* 调支付宝网关 */ }
}
public class WechatPayChannel implements PayChannel {
    public void pay(long amount) { /* 调微信支付网关 */ }
}

public class PayChannelFactory {
    public static PayChannel create(String type) {
        return switch (type) {          // "脏活"集中一处
            case "ali" -> new AliPayChannel();
            case "wx"  -> new WechatPayChannel();
            default    -> throw new IllegalArgumentException("未知渠道: " + type);
        };
    }
}

// 调用方：零具体类知识
PayChannel channel = PayChannelFactory.create("ali");
channel.pay(100);
```

真实应用：**Spring 的 BeanFactory**（容器是终极工厂：你声明、它创建和装配）、FactoryBean、JDK 的 `Calendar.getInstance()`、枚举的 `valueOf`。

### 三、策略模式

**意图**：把一族可互换的算法各封装成一个类，算法与使用者互不影响、可独立演化。

```
Context ──持有引用──► <<interface>> Strategy
                        ▲       ▲       ▲
                   StrategyA StrategyB StrategyC   （运行时随意替换）
```

### 重点：if-else 堆叠 → 策略 + 工厂重构（面试必考）

**重构前**——打折方法已经长出 20 个分支：

```java
public BigDecimal discount(String memberType, BigDecimal amount) {
    if ("NORMAL".equals(memberType)) {
        return amount.multiply(new BigDecimal("1.00"));
    } else if ("SILVER".equals(memberType)) {
        return amount.multiply(new BigDecimal("0.95"));
    } else if ("GOLD".equals(memberType)) {
        return amount.multiply(new BigDecimal("0.80"));
    } else if ("DIAMOND".equals(memberType)) {
        // ... 还有 17 个分支，逻辑混在一起，改一个要回归全部
    }
    throw new IllegalArgumentException(memberType);
}
```

**重构后**——每个档位一个策略类 + Spring 自动注册的工厂：

```java
// 1. 策略接口：自带"我处理哪种类型"的声明
public interface DiscountStrategy {
    String type();
    BigDecimal discount(BigDecimal amount);
}

// 2. 一个策略一个类：逻辑内聚、可单独写单测
@Component
public class GoldDiscountStrategy implements DiscountStrategy {
    public String type() { return "GOLD"; }
    public BigDecimal discount(BigDecimal amount) {
        return amount.multiply(new BigDecimal("0.80"));
    }
}

// 3. 工厂/注册表：构造器注入全部策略，启动时一次性转成 Map
@Component
public class DiscountStrategyFactory {
    private final Map<String, DiscountStrategy> registry = new HashMap<>();

    public DiscountStrategyFactory(List<DiscountStrategy> strategies) {
        strategies.forEach(s -> registry.put(s.type(), s));
    }

    public DiscountStrategy get(String type) {
        return Objects.requireNonNull(registry.get(type), "未知会员类型: " + type);
    }
}

// 4. 调用方：零 if-else
public BigDecimal discount(String memberType, BigDecimal amount) {
    return discountStrategyFactory.get(memberType).discount(amount);
}
```

关键收益：**新增档位 = 新增一个 @Component 类**，Spring 启动时自动把它收集进 List 注册到 Map，老代码一行不改——开闭原则的完美落地。

真实应用：JDK `Arrays.sort(x, Comparator)`（比较算法可换）、Spring `Resource` 家族（ClassPathResource/FileSystemResource 由 DefaultResourceLoader 按需创建）、线程池的 `RejectedExecutionHandler` 四种拒绝策略。

### 四、观察者模式

**意图**：一对多的依赖关系，目标状态一变，所有观察者自动收到通知——发布方和订阅方彻底解耦。

```
                ┌────────────────┐   维护列表   ┌──────────────────┐
  publish ────► │    Subject     │ ──────────► │  List<Observer>  │
  事件          │   (状态源)      │             └──▲─────▲─────▲───┘
                └────────────────┘     notify()    │     │     │
                                        ───────────┘     │     └─────
                                              Observer1 / Observer2 / Observer3
                                                    各自回调 update(event)
```

```java
// 事件对象
public class OrderPaidEvent {
    public final long orderId;
    public OrderPaidEvent(long orderId) { this.orderId = orderId; }
}

@Service
public class OrderService {
    private final ApplicationEventPublisher publisher;   // Subject 角色

    public OrderService(ApplicationEventPublisher publisher) {
        this.publisher = publisher;
    }

    public void pay(long orderId) {
        // ... 校验、改状态、落库
        publisher.publishEvent(new OrderPaidEvent(orderId)); // 发完就走，不认识任何消费者
    }
}

@Component
class PointListener {
    @EventListener
    public void onPaid(OrderPaidEvent e) { /* 加积分 */ }
}

@Component
class SmsListener {
    @EventListener
    @Async
    public void onPaid(OrderPaidEvent e) { /* 发短信通知 */ }
}
```

加下游 = 加一个监听器类，OrderService 一行不改。**MQ 就是跨进程版的观察者模式**：生产者 = Subject，多个消费者组 = Observer，天然解耦 + 削峰。

### 五、单例（一句话带过）

单例的本质是"工厂 + 唯一实例"，其双重检查锁是并发竞争的典型案例——本系列已有单例篇（basics/singleton-pattern）详细推演，此处只记它与工厂、模板方法（getInstance 骨架）的亲缘关系。

### 六、模式选型对比表

| 模式 | 解决的问题 | 触发信号 | 代价 |
| --- | --- | --- | --- |
| 工厂 | 创建与使用解耦 | new 散落各处、具体类型常变 | 多一层工厂类 |
| 策略 | 消灭条件分支堆叠 | 同一方法按类型分叉且分支还在涨 | 类数量变多，需注册表 |
| 观察者 | 一对多通知解耦 | 主流程里塞满"办完之后还要 A/B/C" | 通知链长难排查（异步/MQ 缓解） |
| 模板方法 | 复用流程骨架 | 多个流程只差几步 | 继承耦合，可用回调替代 |

选型口诀：**"做什么"在变用策略，"造什么"在变用工厂，"通知谁"在变用观察者。**

## 面试答法

### 30 秒版（直接背诵）

> 六大设计原则核心是开闭原则和依赖倒置：对扩展开放、对修改关闭，依赖抽象不依赖具体。最常用的三个模式：工厂模式把 new 集中到一处，调用方只认接口，Spring 的 BeanFactory 就是终极工厂；策略模式把一族可互换算法各封装成类，面试重点是我会用"策略接口 + 每分支一个 @Component 类 + 工厂构造器注入 List 转成 Map 注册表"把二十个 if-else 重构成零分支，新增分支只加类不改老代码；观察者模式解耦一对多通知，Spring 里是 ApplicationEventPublisher 加 @EventListener，MQ 就是跨进程的观察者。选型口诀：做什么在变用策略，造什么在变用工厂，通知谁在变用观察者。

### 深入版（被追问时按这条线展开）

1. **原则**：OCP + DIP 是灵魂，其余四原则是配套约束
2. **工厂**：意图 → 手写支付渠道工厂 → Spring BeanFactory / JDK Calendar
3. **策略**：意图 → if-else 前后对比代码（重点，List→Map 自动注册机制必须讲透）→ JDK Comparator、拒绝策略
4. **观察者**：意图 → Spring 事件手写代码 → MQ 是跨进程观察者
5. **单例**：一句话带过，指向单例专篇
6. **收尾**：选型对比表 + 口诀

### 常见追问

- **策略工厂自动注册的原理？** → Spring 会把所有实现该接口的 Bean 注入成一个 List，工厂在构造器里按 type() 分组进 Map，启动时一次完成，运行期只查表。
- **模板方法和策略模式的区别？** → 模板方法靠**继承**复用骨架（编译期固定），策略靠**组合**+接口（运行时可换，更灵活，符合合成复用原则）。
- **观察者同步通知会拖慢发布者？** → Spring 的 @EventListener 默认同步执行在发布线程里；用 @Async 转异步，或干脆发 MQ 彻底解耦。
- **工厂的三种形态区别？** → 简单工厂=静态方法（加产品要改工厂，违反 OCP）；工厂方法=一个产品一个工厂（对扩展开放）；抽象工厂=一个工厂造一族相关产品。
- **策略模式会不会导致类爆炸？** → 会：分支多但每个都很薄时，可用枚举+方法引用或 lambda 收敛；原则是"分支有独立演化/独立测试价值才拆类"。
- **什么时候不该上模式？** → if-else 不超过三个且稳定，直接写最清楚；模式解决"真实发生的变化"，不是想象中的通用性，否则就是过度设计。
