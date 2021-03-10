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