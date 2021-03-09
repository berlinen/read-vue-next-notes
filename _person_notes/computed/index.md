## 计算属性 API： computed

example

```vue
<script>
  const count = ref(1);
  const plusOne = computed(() => count.vule++);
  console.log(plusOne.value); // 2
  plusOne.value++ // error
  count.value++
  console.log(plusOne.value) // 3
</script>
```

从代码中可以看到，我们先使用 ref API 创建了一个响应式对象 count，然后使用 computed API 创建了另一个响应式对象 plusOne，它的值是 count.value + 1，当我们修改 count.value 的时候， plusOne.value 就会自动发生变化。

注意，这里我们直接修改 plusOne.value 会报一个错误，这是因为如果我们传递给 computed 的是一个函数，那么这就是一个 getter 函数，我们只能获取它的值，而不能直接修改它。

在 getter 函数中，我们会根据响应式对象重新计算出新的值，这也就是它被叫做计算属性的原因，而这个响应式对象，就是计算属性的依赖。

有时候我们也希望能够直接修改 computed 的返回值，那么我们可以给 computed 传入一个对象：

```vue
<script>
  const count = ref(1)
  const plusOne = computed({
    get: () => count.value + 1,
    set: val => {
      count.value = val - 1
    }
  })
  plusOne.value = 1
  console.log(count.value) // 0
</script>
```

我们给 computed 函数传入了一个拥有 getter 函数和 setter 函数的对象，getter 函数和之前一样，还是返回 count.value + 1；而 setter 函数，请注意，这里我们修改 plusOne.value 的值就会触发 setter 函数，其实 setter 函数内部实际上会根据传入的参数修改计算属性的依赖值 count.value，因为一旦依赖的值被修改了，我们再去获取计算属性就会重新执行一遍 getter，所以这样获取的值也就发生了变化。

### 分析运行机制

```vue
<template>
  <div>
    {{ plusOne }}
  </div>
  <button @click="plus">plus</button>
</template>

<script>
import { ref, computed } from 'vue';

export default {
  setup () {
    const count = ref(0);

    const plusOne = computed(() => count.value + 1);

    const plus = () => {
      count.value++
    };

    return {
      plus,
      plusOne
    }
  }
}
</script>
```

可以看到，在这个例子中我们利用 computed API 创建了计算属性对象 plusOne，它传入的是一个 getter 函数，为了和后面计算属性对象的 getter 函数区分，我们把它称作 computed getter。另外，组件模板中引用了 plusOne 变量和 plus 函数。

组件渲染阶段会访问 plusOne，也就触发了 plusOne 对象的 getter 函数：

由于默认 dirty 是 true，所以这个时候会执行 runner 函数，并进一步执行 computed getter，也就是 count.value + 1，因为访问了 count 的值，并且由于 count 也是一个响应式对象，所以就会触发 count 对象的依赖收集过程

请注意，由于是在 runner 执行的时候访问 count，所以这个时候的 activeEffect 是 runner 函数。runner 函数执行完毕，会把 dirty 设置为 false，并进一步执行 track（computed,"get",'value') 函数做依赖收集，这个时候 runner 已经执行完了，所以 activeEffect 是组件副作用渲染函数。

所以你要特别注意这是两个依赖收集过程：对于 plusOne 来说，它收集的依赖是组件副作用渲染函数；对于 count 来说，它收集的依赖是 plusOne 内部的 runner 函数。

然后当我们点击按钮的时候，会执行 plus 函数，函数内部通过 count.value++ 修改 count 的值，并派发通知。请注意，这里不是直接调用 runner 函数，而是把 runner 作为参数去执行 scheduler 函数。我们来回顾一下 trigger 函数内部对于 effect 函数的执行方式:

```js
const run = (effect) => {
  // 调度执行
  if (effect.options.scheduler) {
    effect.options.scheduler(effect)
  }
  else {
    // 直接运行
    effect()
  }
}
```

computed API 内部创建副作用函数时，已经配置了 scheduler 函数，如下：

```js
scheduler: () => {
  if (!dirty) {
    dirty = true
    // 派发通知，通知运行访问该计算属性的 activeEffect
    trigger(computed, "set" /* SET */, 'value')
  }
}
```

它并没有对计算属性求新值，而仅仅是把 dirty 设置为 true，再执行 trigger(computed, "set" , 'value')，去通知执行 plusOne 依赖的组件渲染副作用函数，即触发组件的重新渲染。

在组件重新渲染的时候，会再次访问 plusOne，我们发现这个时候 dirty 为 true，然后会再次执行 computed getter，此时才会执行 count.value + 1 求得新值。这就是虽然组件没有直接访问 count，但是当我们修改 count 的值的时候，组件仍然会重新渲染的原因。

![avatar](/_person_notes/images/computed.png);