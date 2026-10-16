import { defineConfig } from 'vitepress'

export default defineConfig({
  title: '技术面试知识库',
  description: 'Vue / React 底层原理、前端基础面试题与 Java 后端高频考点',

  // 忽略 README/QUICKSTART 中的本地开发示例地址
  ignoreDeadLinks: [/localhost:5173/],

  // 主题配置
  themeConfig: {
    // 侧边栏
    sidebar: [
      {
        text: 'Vue 底层',
        collapsed: false,
        items: [
          {
            text: '基础与实战',
            collapsed: false,
            items: [
              { text: 'Arco Design 配置', link: '/vue/basics/arco-config' },
              { text: '实例与应用：Vue2 vs Vue3', link: '/vue/basics/instance-vs-app' },
              { text: '事件处理', link: '/vue/basics/event-handling' },
              { text: 'Promise 弹窗方案', link: '/vue/dialogs/promise-dialog' },
              { text: 'createDialog 工厂', link: '/vue/dialogs/create-dialog' },
              { text: '命令式组件调用', link: '/vue/dialogs/imperative-dialog' }
            ]
          },
          {
            text: '响应式系统',
            collapsed: false,
            items: [
              { text: '响应式系统核心', link: '/vue/reactivity/reactivity' },
              { text: 'Vue2 vs Vue3 响应式', link: '/vue/reactivity/vue2-vs-vue3' },
              { text: 'computed 与 watch', link: '/vue/reactivity/computed-watch' },
              { text: '浅层 API 与性能优化', link: '/vue/reactivity/shallow-api' },
              { text: '手写响应式（完整版）', link: '/vue/handwritten/mini-reactivity' }
            ]
          },
          {
            text: '编译与渲染',
            collapsed: false,
            items: [
              { text: '编译流程', link: '/vue/compiler/compile-flow' },
              { text: '指令编译', link: '/vue/compiler/directive-compile' },
              { text: '代码生成', link: '/vue/compiler/codegen' },
              { text: 'SFC 编译', link: '/vue/compiler/sfc-compile' },
              { text: '编译优化', link: '/vue/compiler/compile-optimization' },
              { text: 'render 和 h 函数', link: '/vue/rendering/render-and-h' },
              { text: '应用挂载与组件挂载流程', link: '/vue/rendering/mount-flow' },
              { text: '虚拟 DOM', link: '/vue/rendering/virtual-dom' },
              { text: 'Diff 算法与 key', link: '/vue/rendering/diff-key' },
              { text: 'nextTick 与异步更新', link: '/vue/rendering/next-tick' }
            ]
          },
          {
            text: '组件系统',
            collapsed: false,
            items: [
              { text: '组件系统', link: '/vue/components/component-system' },
              { text: '组件的本质形态', link: '/vue/components/component-essence' },
              { text: 'v-model 原理', link: '/vue/components/v-model' },
              { text: 'keep-alive 原理', link: '/vue/components/keep-alive' },
              { text: '函数式组件', link: '/vue/components/functional-component' },
              { text: '生命周期', link: '/vue/components/lifecycle' },
              { text: 'provide / inject', link: '/vue/components/provide-inject' },
              { text: '插槽 slot', link: '/vue/components/slot' },
              { text: 'Teleport 传送门', link: '/vue/components/teleport' },
              { text: '异步组件', link: '/vue/components/async-component' }
            ]
          },
          {
            text: '高级话题',
            collapsed: false,
            items: [
              { text: '运行时架构', link: '/vue/advanced/runtime-architecture' },
              { text: '组合式 API', link: '/vue/advanced/composition-api' },
              { text: '自定义渲染器', link: '/vue/advanced/custom-renderer' },
              { text: '自定义指令', link: '/vue/advanced/custom-directive' },
              { text: '模板 ref', link: '/vue/advanced/template-ref' },
              { text: '动态组件', link: '/vue/advanced/dynamic-component' },
              { text: '过渡与动画', link: '/vue/advanced/transition' },
              { text: 'Vue Router', link: '/vue/advanced/router' },
              { text: 'Pinia 状态管理', link: '/vue/advanced/pinia' },
              { text: 'SSR 与水合', link: '/vue/advanced/ssr' }
            ]
          },
          {
            text: '框架对比',
            collapsed: false,
            items: [
              { text: 'Vue vs React', link: '/compare/vue-vs-react' }
            ]
          }
        ]
      },
      {
        text: 'React 底层',
        collapsed: false,
        items: [
          { text: 'React 原理总览', link: '/react/' },
          {
            text: 'JSX 与 Element',
            collapsed: false,
            items: [
              { text: 'JSX 本质与编译', link: '/react/jsx/jsx-compile' },
              { text: 'Element 与 Fiber', link: '/react/jsx/element-vs-fiber' }
            ]
          },
          {
            text: 'Fiber 架构',
            collapsed: false,
            items: [
              { text: '为什么要 Fiber', link: '/react/fiber/why-fiber' },
              { text: '双缓冲与两阶段', link: '/react/fiber/double-buffer' },
              { text: '协调与 Diff', link: '/react/fiber/reconcile-diff' }
            ]
          },
          {
            text: 'Hooks 原理',
            collapsed: false,
            items: [
              { text: 'Hooks 链表', link: '/react/hooks/hooks-link' },
              { text: 'useState 与更新队列', link: '/react/hooks/usestate-queue' },
              { text: 'useEffect 与 useMemo', link: '/react/hooks/effect-and-memo' },
              { text: '手写简化版 Hooks', link: '/react/hooks/handwritten-hooks' }
            ]
          },
          {
            text: '调度与并发',
            collapsed: false,
            items: [
              { text: 'Scheduler 与时间切片', link: '/react/scheduler/scheduler-slice' },
              { text: 'Lane 优先级模型', link: '/react/scheduler/lane-model' },
              { text: '并发特性', link: '/react/scheduler/concurrent' },
              { text: 'Suspense 原理', link: '/react/scheduler/suspense' }
            ]
          },
          {
            text: '事件系统',
            collapsed: false,
            items: [
              { text: '合成事件', link: '/react/events/synthetic-event' }
            ]
          },
          {
            text: 'Context 与 Ref',
            collapsed: false,
            items: [
              { text: 'Context 原理', link: '/react/context/context' },
              { text: 'Ref 体系', link: '/react/ref/ref-system' }
            ]
          },
          {
            text: '渲染与表单',
            collapsed: false,
            items: [
              { text: 'Portals', link: '/react/render/portals' },
              { text: '受控与非受控组件', link: '/react/forms/controlled-uncontrolled' }
            ]
          },
          {
            text: '优化与生命周期',
            collapsed: false,
            items: [
              { text: 'memo 与 PureComponent', link: '/react/optimization/memo-purecomponent' },
              { text: '错误边界', link: '/react/optimization/error-boundary' },
              { text: '类组件生命周期', link: '/react/lifecycle/class-lifecycle' }
            ]
          },
          {
            text: '状态管理与路由',
            collapsed: false,
            items: [
              { text: '状态管理方案', link: '/react/state/state-management' },
              { text: 'React Router', link: '/react/ecosystem/router' }
            ]
          },
          {
            text: '现代特性与 SSR',
            collapsed: false,
            items: [
              { text: 'React 18 新 Hooks', link: '/react/modern/react18-hooks' },
              { text: 'React 19 新特性', link: '/react/modern/react19' },
              { text: 'SSR 与水合', link: '/react/ssr/ssr-hydration' }
            ]
          },
          {
            text: '手写实现',
            collapsed: false,
            items: [
              { text: '手写 mini-react', link: '/react/handwritten/mini-react' }
            ]
          }
        ]
      },
      {
        text: '前端基础',
        collapsed: false,
        items: [
          { text: '类型转换与隐式转换', link: '/interview/frontend-basics/types-coercion' },
          { text: '深拷贝与浅拷贝', link: '/interview/frontend-basics/deep-copy' },
          { text: '事件冒泡与事件委托', link: '/interview/frontend-basics/event-delegation' },
          { text: '闭包与 this 指向', link: '/interview/frontend-basics/closure-this' },
          { text: '原型链与继承', link: '/interview/frontend-basics/prototype-chain' },
          { text: '防抖与节流', link: '/interview/frontend-basics/debounce-throttle' },
          { text: '事件循环（Event Loop）', link: '/interview/frontend-basics/event-loop' },
          { text: 'HTTP 缓存机制', link: '/interview/frontend-basics/http-cache' },
          { text: '跨域与 CORS/代理', link: '/interview/frontend-basics/cross-domain' },
          { text: 'Promise 与 async/await', link: '/interview/frontend-basics/promise-async' },
          { text: 'Web 性能优化', link: '/interview/frontend-basics/performance-optimization' }
        ]
      },
      {
        text: 'Vue & React',
        collapsed: false,
        items: [
          { text: 'Vue 生命周期', link: '/interview/vue-react/vue-lifecycle' },
          { text: '组件通信方式', link: '/interview/vue-react/component-communication' },
          { text: 'reactive 与 ref 的区别', link: '/interview/vue-react/reactive-vs-ref' },
          { text: 'React 常用 Hooks', link: '/interview/vue-react/react-hooks' },
          { text: '组合式 vs 选项式 API', link: '/interview/vue-react/composition-vs-options' },
          { text: 'computed 与 watch', link: '/interview/vue-react/computed-watch' },
          { text: '列表为什么需要 key', link: '/interview/vue-react/list-key' },
          { text: 'React 性能优化（memo 三件套）', link: '/interview/vue-react/react-memo' },
          { text: 'setState 是同步还是异步', link: '/interview/vue-react/setstate-batch' },
          { text: 'React 闭包陷阱', link: '/interview/vue-react/hooks-closure' },
          { text: 'React Fiber 架构', link: '/interview/vue-react/fiber-architecture' },
          { text: 'Vue3 与 React Diff 对比', link: '/interview/vue-react/vue-react-diff' }
        ]
      },
      {
        text: 'Java',
        collapsed: false,
        items: [
          {
            text: 'Java 基础',
            collapsed: false,
            items: [
              { text: 'String/StringBuilder 与常量池', link: '/interview/java/basics/string-types' },
              { text: '接口、抽象类与值传递', link: '/interview/java/basics/interface-vs-abstract' },
              { text: 'ArrayList 与 LinkedList', link: '/interview/java/basics/arraylist-linkedlist' },
              { text: '异常体系', link: '/interview/java/basics/exception-system' },
              { text: 'equals 与 hashCode 契约', link: '/interview/java/basics/equals-hashcode' },
              { text: '单例模式', link: '/interview/java/basics/singleton-pattern' },
              { text: 'HashMap 底层原理', link: '/interview/java/basics/hashmap' },
              { text: 'BIO/NIO/AIO 与多路复用', link: '/interview/java/basics/io-model' },
              { text: '反射与动态代理', link: '/interview/java/basics/reflection-proxy' }
            ]
          },
          {
            text: '并发编程',
            collapsed: false,
            items: [
              { text: '线程池参数与工作流程', link: '/interview/java/concurrent/thread-pool' },
              { text: 'synchronized 与 ReentrantLock', link: '/interview/java/concurrent/synchronized-vs-reentrantlock' },
              { text: 'CAS 原理与原子类', link: '/interview/java/concurrent/cas-atomic' },
              { text: 'ConcurrentHashMap', link: '/interview/java/concurrent/concurrent-hashmap' },
              { text: 'JUC 同步工具三兄弟', link: '/interview/java/concurrent/juc-tools' },
              { text: 'volatile 与 JMM', link: '/interview/java/concurrent/volatile-jmm' },
              { text: 'ThreadLocal 原理与内存泄漏', link: '/interview/java/concurrent/threadlocal' }
            ]
          },
          {
            text: 'JVM',
            collapsed: false,
            items: [
              { text: '运行时内存区域', link: '/interview/java/jvm/memory-model' },
              { text: 'GC 算法与收集器', link: '/interview/java/jvm/gc' },
              { text: '双亲委派模型', link: '/interview/java/jvm/classloading' },
              { text: 'JVM 调优思路与参数', link: '/interview/java/jvm/jvm-tuning' },
              { text: '线上 OOM 排查流程', link: '/interview/java/jvm/oom-troubleshoot' }
            ]
          },
          {
            text: 'MySQL',
            collapsed: false,
            items: [
              { text: '索引原理与失效场景', link: '/interview/java/mysql/index' },
              { text: '慢 SQL 优化流程', link: '/interview/java/mysql/slow-query' },
              { text: '主从复制与分库分表', link: '/interview/java/mysql/mysql-replication' },
              { text: '事务隔离级别与 MVCC', link: '/interview/java/mysql/transaction-mvcc' },
              { text: 'redo/undo/binlog 三大日志', link: '/interview/java/mysql/redo-undo-binlog' }
            ]
          },
          {
            text: 'Redis',
            collapsed: false,
            items: [
              { text: '底层数据结构与编码', link: '/interview/java/redis/data-structure' },
              { text: 'RDB 与 AOF 持久化', link: '/interview/java/redis/persistence' },
              { text: '穿透、击穿与雪崩', link: '/interview/java/redis/cache-three-brothers' },
              { text: '主从、哨兵与集群', link: '/interview/java/redis/redis-cluster' },
              { text: '缓存与数据库一致性', link: '/interview/java/redis/cache-consistency' },
              { text: 'Redis 分布式锁', link: '/interview/java/redis/distributed-lock' }
            ]
          },
          {
            text: 'Spring',
            collapsed: false,
            items: [
              { text: 'BeanFactory 与容器启动流程', link: '/interview/java/spring/container-refresh' },
              { text: 'IOC 与 AOP、循环依赖', link: '/interview/java/spring/ioc-aop' },
              { text: 'Bean 生命周期', link: '/interview/java/spring/bean-lifecycle' },
              { text: 'AOP 底层原理', link: '/interview/java/spring/aop-principle' },
              { text: '事务失效场景', link: '/interview/java/spring/transaction' },
              { text: 'SpringBoot 自动配置原理', link: '/interview/java/spring/springboot-autoconfig' }
            ]
          },
          {
            text: '消息队列',
            collapsed: false,
            items: [
              { text: '消息不丢失、不重复、顺序消费', link: '/interview/java/mq/message-reliability' },
              { text: 'MQ 高可用与消息积压', link: '/interview/java/mq/high-availability' }
            ]
          },
          {
            text: '分布式',
            collapsed: false,
            items: [
              { text: '接口幂等设计', link: '/interview/java/distributed/idempotency' },
              { text: '限流、熔断与降级', link: '/interview/java/distributed/rate-limit-circuit' },
              { text: '分布式事务方案', link: '/interview/java/distributed/distributed-transaction' }
            ]
          }
        ]
      }
    ],

    // 顶部导航
    nav: [
      { text: '首页', link: '/' },
      { text: 'Vue 底层', link: '/vue/reactivity/reactivity' },
      { text: 'React 底层', link: '/react/' },
      { text: '前端基础', link: '/interview/frontend-basics/closure-this' },
      { text: 'Vue & React', link: '/interview/vue-react/reactive-vs-ref' },
      { text: 'Java', link: '/interview/java/basics/hashmap' }
    ],

    // 社交链接
    socialLinks: [
      { icon: 'github', link: 'https://github.com/vuejs/core' }
    ],

    // 搜索
    search: {
      provider: 'local'
    },

    // 页脚
    footer: {
      message: '基于 Vue / React 深度技术问答对话记录整理',
      copyright: 'MIT License'
    }
  }
})
