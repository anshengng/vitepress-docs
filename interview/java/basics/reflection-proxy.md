# 反射与动态代理

## 题目

> 反射是什么？有哪些入口 API？JDK 动态代理的原理是什么，为什么只能代理接口？CGLIB 有什么区别？Spring AOP 怎么选？

## 核心要点

### 反射是什么

反射 = 程序在**运行时**动态获取任意类的信息（字段/方法/构造器/注解），并能创建实例、调用方法、读写字段——哪怕成员是 private。

先理解 Class 对象与实例的关系：

```
User.java ──javac──► User.class 字节码文件
                        │  类加载时 JVM 为每个类生成【唯一】的 Class 对象
                        ▼
                  Class 对象（元空间，类的"说明书"）
                  ├── Field[] name, age ...  ├── Method[] save() ...  ├── Constructor[]
                        │  new User() / newInstance()
                        ▼
                  实例 u1      实例 u2      实例 u3
                  （u1.getClass() 都指向同一个 Class 对象）
```

- 普通调用：编译期写死 `user.save()`
- 反射调用：运行期才决定调谁 `method.invoke(obj)` —— 这就是"框架能动起来"的根基

### 三大入口 API

```java
// ① 拿 Class 对象（三种方式）
Class<?> c = Class.forName("com.demo.User");  // 全限定名，配置驱动（最常用）
Class<?> c2 = User.class;                     // 类字面量
Class<?> c3 = user.getClass();                // 实例反查

// ② 读写字段（能穿透 private）
Field f = c.getDeclaredField("name");
f.setAccessible(true);                        // 关闭访问检查
f.set(user, "张三");

// ③ 调用方法
Method m = c.getDeclaredMethod("save", String.class);
m.setAccessible(true);
Object result = m.invoke(user, "参数");        // 等价于 user.save("参数")

// ④ 创建实例
Object obj = c.getDeclaredConstructor().newInstance();
```

### 反射能干什么（框架的地基）

| 场景 | 反射干了什么 |
| --- | --- |
| Spring IOC | 扫描注解拿类名 → forName → newInstance 造 Bean → 反射注入 @Autowired 字段 |
| Spring AOP | 代理对象拦截方法后，反射调用目标方法 |
| MyBatis | 查库按列名反射找 setter，把结果装进实体类 |
| JSON/序列化 | 反射遍历字段拼 JSON、读 JSON 回填对象 |

### 代价与争议

- **性能**：比直接调用慢（查方法表、参数装 Object[]、访问检查），JIT 有优化、setAccessible(true) 关检查可缓解；热点高频路径别滥用
- **破坏封装**：setAccessible 能改 private 字段、调 private 方法，单例也能被反射绕过构造器打破——封装约定在反射面前形同虚设

### 静态代理：手写一个"包一层"

```java
interface Pay {
    void pay(int money);
}

class RealPay implements Pay {                        // 目标类：只管支付
    public void pay(int money) { System.out.println("支付 " + money); }
}

class PayLogProxy implements Pay {                    // 代理类：包住目标加日志
    private final Pay target;
    PayLogProxy(Pay target) { this.target = target; }

    public void pay(int money) {
        System.out.println("[log] pay 开始");         // 前置增强
        target.pay(money);                            // 转发给目标
        System.out.println("[log] pay 结束");         // 后置增强
    }
}
```

两大缺点：

1. **接口一变全变**：Pay 新增一个方法，RealPay 和所有代理类都得跟着改
2. **类爆炸**：每个目标类 × 每种增强组合都要手写一个代理类，几百个接口根本写不完

→ 动态代理：代理类在**运行时自动生成**，增强逻辑集中写在一处。

### JDK 动态代理原理

```
Proxy.newProxyInstance(classLoader, interfaces, handler)
        │  运行时在内存里生成字节码并加载
        ▼
final class $Proxy0 extends Proxy implements Pay {
    private static Method m1;                    // 类加载时反射缓存的 Method
    public final void pay(int money) { super.h.invoke(this, m1, new Object[]{money}); }
}
        │
        ▼
InvocationHandler.invoke(proxy, method, args)  // 你写的增强逻辑（日志/事务/鉴权）
        │  前置增强
        ▼
method.invoke(target, args) ──反射──► RealPay.pay()   // 真正干活
        │  后置增强
```

**为什么 JDK 代理只能代理接口**：生成的 $Proxy0 已经 `extends Proxy`（转发用的 h 字段、防护逻辑都在 Proxy 里），Java 单继承，父类位置被占死，只能通过 implements 接口来获得类型；而且它的设计本就不是重写目标类方法，而是把所有方法统一转给 handler。

### CGLIB：继承目标类来代理

- 原理：用字节码库（ASM）在运行时生成**目标类的子类**，重写非 final 方法，方法体转给 MethodInterceptor.intercept，内部再反射调父类（即目标）方法
- 天生限制：final 类没法被继承；final/private/static 方法没法被重写 → 代理不了
- 顺带要求：目标类要有可用的构造器（生成子类时要调 super）

两种代理的"挂靠方式"完全不同，画成继承树一目了然：

```
【JDK 动态代理】兄弟关系——都实现同一个接口，谁也不认识谁

              interface UserService
                 ▲                ▲
                 │ implements     │ implements
        UserServiceImpl         $Proxy0（运行时生成）
        （目标，干活）            │ 每个方法都转给
                                ▼
                        InvocationHandler.invoke
                        （增强逻辑 + 反射调 target）

【CGLIB 代理】父子关系——代理是目标的子类，直接继承家业

              UserServiceImpl（目标）
                 ▲
                 │ extends
        UserServiceImpl$$EnhancerByCGLIB（运行时生成）
        │ 重写 save() → MethodInterceptor.intercept()
        │ intercept 里：前置增强 → super.save()（调父类=目标）→ 后置增强
        └ 方法没被重写的（final/private/static）→ 调用时直奔父类，代理拦不住 ❌
```

### JDK vs CGLIB 对比

| 对比 | JDK 动态代理 | CGLIB |
| --- | --- | --- |
| 实现方式 | 生成类 implements 接口 | 生成目标类的子类 |
| 前提 | 目标必须实现接口 | 类和方法不能是 final |
| 回调入口 | InvocationHandler.invoke | MethodInterceptor.intercept |
| 依赖 | JDK 自带 | 第三方字节码库（Spring 已内置封装） |
| 典型用户 | MyBatis Mapper、RPC 框架 | Spring AOP（无接口时） |

### Spring AOP 的选择规则

```
目标类有实现接口吗？
   │
   ├─ 有 ──► proxy-target-class=false（默认）──► JDK 动态代理
   │         注入时必须写接口类型（代理和目标不是父子关系，强转目标类会 ClassCastException）
   │
   └─ 没有 ─► 自动退到 CGLIB（不继承没东西可代理）

Spring Boot 2.x 起：proxy-target-class 默认 true ──► 一律 CGLIB
（注入可以直接写具体类，省去"必须面向接口"的心智负担）
```

- 目标类实现了接口 → 默认 JDK 动态代理；一个接口都没有 → 自动退到 CGLIB
- Spring Boot 2.x 起 `proxy-target-class` 默认 true → 统一走 CGLIB（避免"注入类型必须写接口"等麻烦）
- 可显式控制：`@EnableAspectJAutoProxy(proxyTargetClass = false)` 强制 JDK 代理

### 手写最小 JDK 动态代理

```java
// 1. 接口 + 目标类
interface UserService {
    void save(String name);
}

class UserServiceImpl implements UserService {
    public void save(String name) { System.out.println("保存用户: " + name); }
}

// 2. 增强逻辑：实现 InvocationHandler
class TimeCostHandler implements InvocationHandler {
    private final Object target;
    TimeCostHandler(Object target) { this.target = target; }

    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        long t = System.currentTimeMillis();
        Object ret = method.invoke(target, args);      // 反射调用目标方法
        System.out.println(method.getName() + " 耗时 "
                + (System.currentTimeMillis() - t) + "ms");
        return ret;
    }
}

// 3. 运行时生成代理并使用
public class Demo {
    public static void main(String[] args) {
        UserService proxy = (UserService) Proxy.newProxyInstance(
                UserService.class.getClassLoader(),      // 与目标同加载器
                new Class[]{ UserService.class },        // 要实现的接口
                new TimeCostHandler(new UserServiceImpl())); // 增强逻辑
        proxy.save("张三");
        // 输出：保存用户: 张三  /  save 耗时 xx ms
    }
}
```

## 面试答法

### 30 秒版（先给框架）

> 反射就是运行时拿到类的 Class 对象，进而查字段、调方法、造实例，private 也能穿透，Spring 的 IOC 和 AOP、MyBatis 的结果映射全靠它。动态代理解决的是"手写代理类会类爆炸"的问题：JDK 动态代理在运行时生成一个继承 Proxy、实现业务接口的 $Proxy0，所有方法都一行流转给 InvocationHandler，在 invoke 里写增强再反射调目标；因为 $Proxy0 的父类位置被 Proxy 占了、Java 单继承，所以只能代理接口。CGLIB 改成生成目标类的子类来重写方法，所以 final 类和 final 方法代理不了。Spring AOP 有接口默认 JDK，没接口用 CGLIB，Boot 2.x 起默认统一 CGLIB。

### 深入版（被追问时按这条线展开）

1. **反射**：Class 对象是类的运行时说明书 → 三大入口（forName / getDeclaredField / getMethod + invoke）→ 框架为什么离不开它
2. **静态代理**：包一层加日志的例子 → 两大缺点（接口耦合、类爆炸）
3. **JDK 动态代理**：$Proxy0 生成原理 → 方法一行流转 handler → 为什么只能代理接口（单继承）
4. **CGLIB**：子类化重写，final 不可代理 → 对比表
5. **Spring 选择**：有接口 JDK、无接口 CGLIB、Boot 默认 proxyTargetClass
6. **落到项目**：说一个自己用过的（@Transactional 的事务开启/提交、全局日志切面）

### 常见追问

- **反射慢在哪？** → 方法查找、参数装箱成 Object[]、每次访问检查；setAccessible(true) + JIT 内联能缓解
- **$Proxy0 是什么时候生成的？** → 第一次调用 newProxyInstance 时在内存生成并加载，同参数组合有缓存
- **CGLIB 代理 final 方法会怎样？** → 不报错，但调用时直接走原方法，增强不生效（没被重写）
- **AOP 什么时候失效？** → 类内部 this 自调用不经过代理对象，增强不生效
