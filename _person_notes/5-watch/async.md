### 侦听器的实现原理和使用场景是什么

```js
import { reactive, watch } from 'vue';
const state = reactive({ count: 0 });
watch(() => state.count, (count, precount) => {
  console.log(count)
});
state.count++
state.count++
state.count++
```

实际上只输出了一次 count 的值，也就是最终计算的值 3。这在大多数场景下都是符合预期的，因为在一个 Tick（宏任务执行的生命周期）内，即使多次修改侦听的值，它的回调函数也只执行一次。

组件的更新过程是异步的，我们知道修改模板中引用的响应式对象的值时，会触发组件的重新渲染，但是在一个 Tick 内，即使你多次修改多个响应式对象的值，组件的重新渲染也只执行一次。

### 异步任务队列的创建

在创建一个 watcher 时，如果配置 flush 为 pre 或不配置 flush ，那么 watcher 的回调函数就会异步执行。此时分别是通过 queueJob 和 queuePostRenderEffect 把回调函数推入异步队列中的。

在不涉及 suspense 的情况下，queuePostRenderEffect 相当于 queuePostFlushCb，

### 优化：只用一个变量

从语义上来看，isFlushPending 用于判断是否在等待 nextTick 执行 flushJobs，而 isFlushing 是判断是否正在执行任务队列。

从功能上来看，它们的作用是为了确保以下两点：

1. 在一个 Tick 内可以多次添加任务到队列中，但是任务队列会在 nextTick 后执行；

2. 在执行任务队列的过程中，也可以添加新的任务到队列中，并且在当前 Tick 去执行剩余的任务队列。


