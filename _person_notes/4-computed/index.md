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
    // 它收集的依赖是 plusTwo 内部的 runner 函数，对于 count 来说，它收集的依赖是 plusOne 内部的 runner 函数。
    const plusOne = computed(() => count.value + 1);

    const plusTwo = computed(() => plusOne.value + 1);

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

### 嵌套属性

从代码中可以看到，当我们访问 plusTwo 的时候，过程和前面都差不多，同样也是两个依赖收集的过程。对于 plusOne 来说，它收集的依赖是 plusTwo 内部的 runner 函数；对于 count 来说，它收集的依赖是 plusOne 内部的 runner 函数。

接着当我们修改 count 的值时，它会派发通知，先运行 plusOne 内部的 scheduler 函数，把 plusOne 内部的 dirty 变为 true，然后执行 trigger 函数再次派发通知，接着运行 plusTwo 内部的 scheduler 函数，把 plusTwo 内部的 dirty 设置为 true。

然后当我们再次访问 plusTwo 的值时，发现 dirty 为 true，就会执行 plusTwo 的 computed getter 函数去执行 plusOne.value + 1，进而执行 plusOne 的 computed gette 即 count.value + 1 + 1，求得最终新值 2。

### 计算属性的执行顺序

我们曾提到计算属性内部创建副作用函数的时候会配置 computed 为 true，标识这是一个 computed effect，用于在 trigger 阶段的优先级排序。

#### 为什么这么设计

```js
import { red, computed } from 'vue';
import { effect } from 'reactive';

const count = ref(0);

const plusOne = computed(() => count.value+1);

effect(() => {
  console.log(plueOne.value + count.value);
})

function plus() {
  count.value++
}

plus();

// 1
// 3
// 3
```

在执行 effect 函数时运行 console.log(plusOne.value + count.value)，所以第一次输出 1，此时 count.value 是 0，plusOne.value 是 1。

后面连续输出两次 3 是因为， plusOne 和 count 的依赖都是这个 effect 函数，所以当我们执行 plus 函数修改 count 的值时，会触发并执行这个 effect 函数，因为 plusOne 的 runner 也是 count 的依赖，count 值修改也会执行 plusOne 的 runner，也就会再次执行 plusOne 的依赖即 effect 函数，因此会输出两次。

那么为什么两次都输出 3 呢？这就跟先执行 computed runner 有关。首先，由于 plusOne 的 runner 和 effect 都是 count 的依赖，当我们修改 count 值的时候， plusOne 的 runner 和 effect 都会执行，那么此时执行顺序就很重要了。

这里先执行 plusOne 的 runner，把 plusOne 的 dirty 设置为 true，然后通知它的依赖 effect 执行 plusOne.value + count.value。这个时候，由于 dirty 为 true，就会再次执行 plusOne 的 getter 计算新值，拿到了新值 2， 再加上 1 就得到 3。执行完 plusOne 的 runner 以及依赖更新之后，再去执行 count 的普通effect 依赖，从而去执行 plusOne.value + count.value，这个时候 plusOne dirty 为 false， 直接返回上次的计算结果 2，然后再加 1 就又得到 3。

知道原因后，我们再回过头看例子。因为 effect 函数依赖了 plusOne 和 count，所以 plusOne 先计算会更合理，这就是为什么我们需要让 computed runner 的执行优先于普通的 effect 函数。




