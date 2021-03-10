## watch api

1.watch API 可以侦听一个 getter 函数，但是它必须返回一个响应式对象，当该响应式对象更新后，会执行对应的回调函数。

```js
import { reactive, watch } from 'vue'
const state = reactive({ count: 0 })
watch(() => state.count, (count, prevCount) => {
  // 当 state.count 更新，会触发此回调函数
})
```

2.watch API 也可以直接侦听一个响应式对象，当响应式对象更新后，会执行对应的回调函数。
```js
import { ref, watch } from 'vue'
const count = ref(0)
watch(count, (count, prevCount) => {
  // 当 count.value 更新，会触发此回调函数
})
```

3.watch API 还可以直接侦听多个响应式对象，任意一个响应式对象更新后，就会执行对应的回调函数。

```js
import { ref, watch } from 'vue'
const count = ref(0)
const count2 = ref(1)
watch([count, count2], ([count, count2], [prevCount, prevCount2]) => {
  // 当 count.value 或者 count2.value 更新，会触发此回调函数
})
```

### watch API 实现原理


### dep
```vue
<script>
import { reactive, watch } from 'vue'
const state = reactive({
  count: {
    a: {
      b: 1
    }
  }
})
watch(state.count, (count, prevCount) => {
  console.log(count)
})
state.count.a.b = 2
</script>
```

这里，我们利用 reactive API 创建了一个嵌套层级较深的响应式对象 state，然后再调用 watch API 侦听 state.count 的变化。接下来我们修改内部属性 state.count.a.b 的值，你会发现 watcher 的回调函数执行了，为什么会执行呢？

。而从上述业务代码来看，我们修改 state.count.a.b 的值时并没有访问它 ，但还是触发了 watcher 的回调函数。

当我们执行 watch 函数的时候，我们知道如果侦听的是一个 reactive 对象，那么内部会设置 deep 为 true，然后执行 traverse 去递归访问对象深层子属性，这个时候就会访问 state.count.a.b 触发依赖收集，这里收集的依赖是 watcher 内部创建的 effect runner。因此，当我们再去修改 state.count.a.b 的时候，就会通知这个 effect ，所以最终会执行 watcher 的回调函数

当我们侦听一个通过 reactive API 创建的响应式对象时，内部会执行 traverse 函数，如果这个对象非常复杂，比如嵌套层级很深，那么递归 traverse 就会有一定的性能耗时。因此如果我们需要侦听这个复杂响应式对象内部的某个具体属性，就可以想办法减少 traverse 带来的性能损耗。

比如刚才的例子，我们就可以直接侦听 state.count.a.b 的变化：

```js
watch(state.count.a, (newVal, oldVal) => {
  console.log(newVal)
})
state.count.a.b = 2
```

这样就可以减少内部执行 traverse 的次数。你可能会问，直接侦听 state.count.a.b 可以吗？答案是不行，因为 state.count.a.b 已经是一个基础数字类型了，不符合 source 要求的参数类型，所以会在非生产环境下报警告。

那么有没有办法优化使得 traverse 不执行呢？答案是可以的。我们可以侦听一个 getter 函数：

```js
watch(() => state.count.a.b, (newVal, oldVal) => {
  console.log(newVal)
})
state.count.a.b = 2 
```