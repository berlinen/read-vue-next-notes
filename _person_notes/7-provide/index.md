## 依赖注入api

```js
// Provider
import { provide, ref } from 'vue'
export default {
  setup() {
    const theme = ref('dark')
    provide('theme', theme)
  }
}

// child
import { inject } from 'vue'
export default {
  setup() {
    const theme = inject('theme', 'light')
    return {
      theme
    }
  }
}

// 这里要说明的是，inject 函数接受第二个参数作为默认值，如果祖先组件上下文没有提供 theme，则使用这个默认值。
```

实际上，你可以把依赖注入看作一部分“大范围有效的 prop”，而且它的规则更加宽松：祖先组件不需要知道哪些后代组件在使用它提供的数据，后代组件也不需要知道注入的数据来自哪里。

![avatar](/_person_notes/images/provide.png)

所以在默认情况下，组件实例的 provides 继承它的父组件，但是当组件实例需要提供自己的值的时候，它使用父级提供的对象创建自己的 provides 的对象原型。通过这种方式，在 inject 阶段，我们可以非常容易通过原型链查找来自直接父级提供的数据。


如果组件实例提供和父级 provides 中有相同 key 的数据，是可以覆盖父级提供的数据。举个例子：

```js
import { createApp, h, provide, inject } from 'vue'
const ProviderOne = {
  setup () {
    provide('foo', 'foo')
    provide('bar', 'bar')
    return () => h(ProviderTwo)
  }
}
const ProviderTwo = {
  setup () {
    provide('foo', 'fooOverride')
    provide('baz', 'baz')
    return () => h(Consumer)
  }
}
const Consumer = {
  setup () {
    const foo = inject('foo')
    const bar = inject('bar')
    const baz = inject('baz')
    return () => h('div', [foo, bar, baz].join('&'))
  }
}
createApp(ProviderOne).mount('#app')
```

可以看到，这是一个嵌套 provider 的情况。根据 provide 函数的实现，ProviderTwo 提供的 key 为 foo 的 provider 会覆盖 ProviderOne 提供的 key 为 foo 的 provider，所以最后渲染在 Consumer 组件上的就是 fooOverride&bar&baz 。

接下来，我们来分析另一个依赖注入的 API —— inject。

