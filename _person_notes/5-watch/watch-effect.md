## watchEffect api

watchEffect API 的作用是注册一个副作用函数，副作用函数内部可以访问到响应式对象，当内部响应式对象变化后再立即执行这个函数。

```js
import { reactive, watchEffect} from 'vue'
const count = ref(0)
watchEffect(() => console.log(count.value))
count.value++
```

它的结果是依次输出 0 和 1。

watchEffect 和前面的 watch API 有哪些不同呢？主要有三点：

1. 侦听的源不同 。watch API 可以侦听一个或多个响应式对象，也可以侦听一个 getter 函数，而 watchEffect API 侦听的是一个普通函数，只要内部访问了响应式对象即可，这个函数并不需要返回响应式对象。

2. 没有回调函数 。watchEffect API 没有回调函数，副作用函数的内部响应式对象发生变化后，会再次执行这个副作用函数。

3. 立即执行 。watchEffect API 在创建好 watcher 后，会立刻执行它的副作用函数，而 watch API 需要配置 immediate 为 true，才会立即执行回调函数。

可以看到，getter 函数就是对 source 函数的简单封装，它会先判断组件实例是否已经销毁，然后每次执行 source 函数前执行 cleanup 清理函数。

watchEffect 内部创建的 runner 对应的 scheduler 对象就是 scheduler 函数本身，这样它再次执行时，就会执行这个 scheduler 函数，并且传入 runner 函数作为参数，其实就是按照一定的调度方式去执行基于 source 封装的 getter 函数。

创建完 runner 后就立刻执行了 runner，其实就是内部同步执行了基于 source 封装的 getter 函数。

### 注册无效回调函数

有些时候，watchEffect 会注册一个副作用函数，在函数内部可以做一些异步操作，但是当这个 watcher 停止后，如果我们想去对这个异步操作做一些额外事情（比如取消这个异步操作），我们可以通过 onInvalidate 参数注册一个无效函数。

```js
import {ref, watchEffect } from 'vue'
const id = ref(0)
watchEffect(onInvalidate => {
  // 执行异步操作
  const token = performAsyncOperation(id.value)
  onInvalidate(() => {
    // 如果 id 发生变化或者 watcher 停止了，则执行逻辑取消前面的异步操作
    token.cancel()
  })
})
```

我们利用 watchEffect 注册了一个副作用函数，它有一个 onInvalidate 参数。在这个函数内部通过 performAsyncOperation 执行某些异步操作，并且访问了 id 这个响应式对象，然后通过 onInvalidate 注册了一个回调函数。

如果 id 发生变化或者 watcher 停止了，这个回调函数将会执行，然后执行 token.cancel 取消之前的异步操作。