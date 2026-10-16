# 双亲委派模型

## 题目

> 什么是双亲委派模型？类加载的完整流程是什么？为什么要这样设计？什么场景需要打破双亲委派，怎么打破？类和类加载器是什么关系？

## 为什么需要双亲委派

JVM 里一个类由 **全限定名 + 加载它的 ClassLoader** 共同唯一确定。如果谁都能随意加载 `java.lang.String`，有人放一个恶意的 `String.class` 到 classpath，你的 `HashMap` 查找、字符串比较就全被人控制了。双亲委派用"层级委托"保证：**核心类只能由核心加载器加载一次，谁都替换不了**。

## 核心要点

### 类加载器层级图（委派向上，加载回退向下）

```
        ┌──────────────────────┐
        │ Bootstrap ClassLoader │  C++ 实现，加载 <JAVA_HOME>/jre/lib 核心类
        │  (rt.jar / java.lang.*)│  （sun.boot.class.path，JDK9+ 改为模块）
        └──────────▲───────────┘
                   │ 委派（"你先加载？你不行我再自己来"）
        ┌──────────┴───────────┐
        │ Extension ClassLoader │  加载 ext 目录（JDK9+ = Platform）
        └──────────▲───────────┘
                   │ 委派
        ┌──────────┴───────────┐
        │ Application ClassLoader│  加载 classpath（你写的业务类）
        └──────────▲───────────┘
                   │ 委派
        ┌──────────┴───────────┐
        │ 自定义 ClassLoader     │  如 Tomcat WebappLoader、OSGi BundleLoader
        └──────────────────────┘

  加载能力方向（回退）：父加载不了 → 子自己 findClass → 子也加载不了 → 抛 ClassNotFoundException
```

- "双亲"是 **parent（父链）** 的翻译：每个 ClassLoader 内部持有 `private final ClassLoader parent`，是**单向链**不是多父；叫"父母"是中文直译的误会，本质是"向上委托、逐级回退"
- 层级之间是**组合（持有 parent 引用）**，不是继承

### 加载一个类的完整流程

```
loadClass("com.foo.Bar")
   │
   ├─ ① 查缓存：这个 loader 及其父链已加载过？ ──是→ 直接返回 Class 对象
   │
   ├─ ② parent != null？ ──是→ 递归 parent.loadClass（一路问到 Bootstrap）
   │
   ├─ ③ 父链都加载不了 → 自己 findClass()
   │        └─ 读字节码（jar/class/网络/解密）→ defineClass() → resolve
   │
   └─ ④ 自己也找不到 → 抛 ClassNotFoundException
```

### 好处图解：模拟恶意 java.lang.String 被拦截

攻击者把假的 `java/lang/String.class` 丢进 classpath，业务代码 `new String("hi")`：

```
时刻  AppClassLoader                     委派链上游
 t1   收到加载 "java.lang.String" 请求
 t2   不自己加载，先问 Extension ───────► 再问 Bootstrap
 t3   Bootstrap：core lib 里有真的！加载并返回 ✅
 t4   App 拿到 Bootstrap 的 String，缓存
 t5   恶意 String.class 全程没人调用 findClass 去读它 → 废纸一张
```

若没有委派（谁先找到谁加载），t2 时 App 在 classpath 先摸到假 String，整个 JVM 的字符串语义就被劫持了。

### 场景一：SPI——线程上下文类加载器打破委派

`DriverManager`（核心类）由 Bootstrap 加载，但 JDBC 驱动实现在 App 的 classpath 里。Bootstrap 的 parent 链里**没有** AppClassLoader，向上委派永远够不着：

```
调用链（委派方向被"反向"打破）：

Bootstrap 加载 DriverManager
   └─ DriverManager.getServiceLoader() 需要加载 com.mysql.cj.jdbc.Driver
        └─ 用 Class.forName(name, true, Thread.currentThread()
                                  .getContextClassLoader())   ← 关键打破点
             └─ TCCL = AppClassLoader（线程创建时从 App 线程继承）
                  └─ App 在 classpath 找到 MySQL Driver ✅

 正常委派：子 → 父（向上）；SPI：父（Bootstrap）借子（TCCL）的手加载（向下）
```

Thread、ThreadLocal、JAXB 等 JDK 内置 SPI 同理。

### 场景二：Tomcat——同级隔离打破委派

```
              Common Loader（Tomcat 自身 + 共享 lib）
             /            \
   WebappA Loader      WebappB Loader     各自加载 /WEB-INF/classes + /WEB-INF/lib
   都有 com.foo.Service 同名类 → 两个独立 Class 对象，互不干扰
```

- 先查**自己**的 Webapp 目录（可覆盖共享类），查不到再委派 Common——顺序与标准模型相反，这就是"打破"
- 目的：多应用部署同名不同版本 jar 不冲突；配合 ThreadLocal 清理防止热部署类加载器泄漏

### 类与 ClassLoader 的关系

```java
// 两个不同的 AppClassLoader 各加载一份 com.foo.Bar
Class<?> c1 = loader1.loadClass("com.foo.Bar");
Class<?> c2 = loader2.loadClass("com.foo.Bar");
c1 == c2                 // false！类身份 = 全限定名 + loader
c1.newInstance() instanceof c2.newInstance()  // false
// 强转 ClassCastException、反射调用 NoSuchMethodException 的经典根因
```

### 自定义 ClassLoader 骨架

```java
public class MyLoader extends ClassLoader {
    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        byte[] bytes = readClassBytesFromSomewhere(name);  // 文件/网络/解密
        return defineClass(name, bytes, 0, bytes.length);  // 只写 findClass，
    }                                                      // loadClass 的委派逻辑别动
}
// 打破委派则重写 loadClass（Tomcat 式），或 setContextClassLoader（SPI 式）
```

## 面试答法

### 30 秒版（可背诵口语）

> 双亲委派是类加载器的层级协作机制：收到加载请求先查缓存，没有就向上委托给 parent，一路到 Bootstrap，父链都加载不了才逐级回退自己 findClass。好处一是核心类唯一——比如有人把恶意 java.lang.String 放 classpath，请求会先被 Bootstrap 用真类满足，假类根本没机会被读；二是避免重复加载。打破它主要有两个场景：SPI 比如 DriverManager 在核心库却要加载 classpath 里的驱动，用线程上下文类加载器反向借子的手；还有 Tomcat 每个 webapp 独立 ClassLoader 做同名类隔离。另外 JVM 里类的身份是全限定名加加载器，同一个类被两个 loader 加载就是两个不相等的 Class。

### 深入版（被追问时按编号展开）

1. **层级图**：Bootstrap→Ext/Platform→App→自定义，委派向上、回退向下，parent 是组合字段不是继承
2. **流程**：缓存→递归父→findClass→defineClass→抛 CNFE 五步
3. **为什么叫双亲**：翻译自 parent 链，单亲链；"父母"是误称
4. **安全模拟**：恶意 String 时间线——App 收到请求先问父，Bootstrap 返回真类，假文件无人问津
5. **SPI 打破**：Bootstrap 够不着 classpath，画 TCCL 调用链，指出 Class.forName 传线程上下文 loader 这个打破点
6. **Tomcat/OSGi**：先己后父 + 同级隔离；同名类不同 loader 不相等；类加载器泄漏与热部署
7. **自定义**：只覆 findClass；真要打破才覆 loadClass

### 常见追问

- **JDK9 模块化后还有 ExtClassLoader 吗？** → 没了，换成 PlatformClassLoader + 模块系统，但双亲委派思想不变
- **双亲委派是硬性规定吗？** → 不是，是 `ClassLoader.loadClass` 的默认实现约定；重写 loadClass 即可绕过
- **Class.forName 和 ClassLoader.loadClass 区别？** → forName 默认触发初始化（执行 static 块）且用调用者 loader；loadClass 只加载不初始化
- **怎么判断两个类是否"同一个类"？** → 全限定名相同 **且** ClassLoader 相同；instanceof/强转/equals 都按这个判
- **SPI 为什么不直接让 App 加载 DriverManager？** → DriverManager 在 rt.jar/模块里，按委派必须由 Bootstrap 加载；是"父需要子的类"的结构性矛盾，只能借 TCCL
