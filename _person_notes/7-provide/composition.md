## 对比模块化共享数据的方式

共享的数据 sharedData：

```js
export const shareData = ref('');
export default {
  name: 'root',
  setup() {
    //
  }
}
```

子组件中使用 sharedData：

```js
import { sharedData } from './Root.js'
export default {
  name: 'Root',
  setup() {
    // 这里直接使用 sharedData 即可
  }
}
```

当然，从这个示例上来看，模块化的方式是可以共享数据，但是 provide 和 inject 与模块化方式有如下几点不同。

### 作用域不同

对于依赖注入，它的作用域是局部范围，所以你只能把数据注入以这个节点为根的后代组件中，不是这棵子树上的组件是不能访问到该数据的；而对于模块化的方式，它的作用域是全局范围的，你可以在任何地方引用它导出的数据。

### 数据来源不同

对于依赖注入，后代组件是不需要知道注入的数据来自哪里，只管注入并使用即可；而对于模块化的方式提供的数据，用户必须明确知道这个数据是在哪个模块定义的，从而引入它。

### 上下文不同

对于依赖注入，提供数据的组件的上下文就是组件实例，而且同一个组件定义是可以有多个组件实例的，我们可以根据不同的组件上下文提供不同的数据给后代组件；而对于模块化提供的数据，它是没有任何上下文的，仅仅是这个模块定义的数据，如果想要根据不同的情况提供不同数据，那么从 API 层面设计就需要做更改。

### 依赖注入的缺陷和应用场景

我们再回到依赖注入，它确实提供了一种组件共享的方式，但并非完美的。正因为依赖注入是上下文相关的，所以它会将你应用程序中的组件与它们当前的组织方式耦合起来，这使得重构变得困难。

来回顾一下依赖注入的特点 ：祖先组件不需要知道哪些后代组件使用它提供的数据，后代组件也不需要知道注入的数据来自哪里。

如果在一次重构中我们不小心挪动了有依赖注入的后代组件的位置，或者是挪动了提供数据的祖先组件的位置，都有可能导致后代组件丢失注入的数据，进而导致应用程序异常。所以，我并不推荐在普通应用程序代码中使用依赖注入。

但是我推荐你在组件库的开发中使用，因为对于一个特定组件，它和其嵌套的子组件上下文联系很紧密。

这里来举一个 Element-UI 组件库 Select 组件的例子：

```vue
<template>
  <el-select v-model="value" placeholder="请选择">
    <el-option
      v-for="item in options"
      :key="item.value"
      :label="item.label"
      :value="item.value">
    </el-option>
  </el-select>
</template>
<script>
  export default {
    data() {
      return {
        options: [{
          value: '选项1',
          label: '黄金糕'
        }, {
          value: '选项2',
          label: '双皮奶'
        }, {
          value: '选项3',
          label: '蚵仔煎'
        }, {
          value: '选项4',
          label: '龙须面'
        }, {
          value: '选项5',
          label: '北京烤鸭'
        }],
        value: ''
      }
    }
  }
</script>
```

子组件 ElOption 负责渲染每一个选项，它的内部想要访问最外层的 ElSelect 组件时，就可以通过依赖注入的方式，在 ElSelect 组件中提供组件的实例：

```js
export default {
  provide() {
    return {
      'select': this
    };
  }
}
```

就这样，我们可以在 ElOption 组件注入这个数据：

```js
export default {
  inject: ['select']
}
```

 使用this.$parent 指向的是它的父组件实例，在我们这个例子是可以的，但如果组件结构发生了变化呢？

 ```vue
 <template>
  <el-select v-model="value" placeholder="请选择">
    <el-option-group
      v-for="group in options"
      :key="group.label"
      :label="group.label">
      <el-option
        v-for="item in group.options"
        :key="item.value"
        :label="item.label"
        :value="item.value">
      </el-option>
    </el-option-group>
  </el-select>
</template>
<script>
  export default {
    data() {
      return {
        options: [{
          label: '热门城市',
          options: [{
            value: 'Shanghai',
            label: '上海'
          }, {
            value: 'Beijing',
            label: '北京'
          }]
        }, {
          label: '城市名',
          options: [{
            value: 'Chengdu',
            label: '成都'
          }, {
            value: 'Shenzhen',
            label: '深圳'
          }, {
            value: 'Guangzhou',
            label: '广州'
          }, {
            value: 'Dalian',
            label: '大连'
          }]
        }],
        value: ''
      }
    }
  }
</script>
 ```

 显然，这里 ElOption 中的 this.$parent 指向的就不是 ElSelect 组件实例，而是 ElOptionGroup 组件实例。但如果我们用依赖注入的方式，即使结构变了，还是可以在 ElOption 组件中正确访问到 ElSelect 的实例。

 his.$parent 是一种强耦合的获取父组件实例方式，非常不利于代码的重构，因为一旦组件层级发生变化，就会产生非预期的后果，所以在平时的开发工作中你应该慎用这个属性。

 相反，在组件库的场景中，依赖注入还是很方便的，除了示例中提供组件实例数据，还可以提供任意类型的数据。因为入口组件和它的相关子组件关联性是很强的，无论后代组件的结构如何变化，最终都会渲染在入口组件的子树上。

 ### 为什么说 Composition API 比 mixin 更适合逻辑复用呢？

 二者都是把复用的逻辑放在单独的文件中维护。但从使用的方式而言，用户只是在需要混入 mixin 的组件中去申明这个 mixin

 ```vue
 <template>
  <div>
    Mouse position: x {{ x }} / y {{ y }}
  </div>
</template>
<script>
import mousePositionMixin from './mouse'
export default {
  mixins: [mousePositionMixin]
}
</script>
 ```

我们在组件中申明了 mousePositionMixin，组件模板中使用的 x、y 就来源于这个 mixin，这一切都是 Vue.js 内部帮我们做的。如果该组件只引入这单个 mixin，问题倒不大，但如果这个组件引入的 mixin 越来越多，很容易出现命名冲突的情况，以及造成数据来源不清晰等问题。

而我们通过 Composition API 去编写功能类似的 hook 函数，使用方式如下：

```vue
<template>
  <div>
    Mouse position: x {{ x }} / y {{ y }}
  </div>
</template>
<script>
  import useMousePosition from './mouse'

  export default {
    setup() {
      const { x, y } = useMousePosition()
      return { x, y }
    }
  }
</script>
```

我们可以清楚地分辨出模板中使用的 x、y 是来源于 useMousePosition 函数，即便我们引入更多的 hook 函数，也不会出现命名冲突的情况。

Composition API 在逻辑复用上确实有不错的优势，但是它并非完美的，使用起来会增加代码量。