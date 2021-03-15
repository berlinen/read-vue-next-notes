import { NodeTransform } from '../transform'
import {
  NodeTypes,
  CompoundExpressionNode,
  createCallExpression,
  CallExpression,
  ElementTypes
} from '../ast'
import { isText } from '../utils'
import { CREATE_TEXT } from '../runtimeHelpers'
import { PatchFlags, PatchFlagNames } from '@vue/shared'

// Merge adjacent text nodes and expressions into a single expression
// e.g. <div>abc {{ d }} {{ e }}</div> should have a single expression node as child.
/**
 * @description
 * text节点转换函数
 * transformText 函数只处理根节点、元素节点、 v-for 以及 v-if 分支相关的节点，它也会返回一个退出函数，因为 transformText 要保证所有表达式节点都已经被处理才执行转换逻辑。
 *
 * transformText 主要的目的就是合并一些相邻的文本节点，然后为内部每一个文本节点创建一个代码生成节点。
 *
 * 在内部，静态文本节点和动态插值节点都被看作是一个文本节点，所以函数首先遍历节点的子节点，然后把子节点中的相邻文本节点合并成一个。
 *
 * 比如示例中的文本节点：<p>hello {{ msg + test }}</p>。
 *
 * 在转换之前，p 节点对应的 children 数组有两个元素，第一个是纯文本节点，第二个是一个插值节点，这个数组也是前面提到的表达式节点转换后的结果：
 *
 * [
    {
      "type": 2,
      "content": "hello ",
    },
    {
      "type": 5,
      "content": {
        "type": 8,
        "children": [
          {
            "type": 4,
            "isConstant": false,
            "content": "_ctx.msg",
            "isStatic": false
          },
          " + ",
          {
            "type": 4,
            "isConstant": false,
            "content": "_ctx.test",
            "isStatic": false
          }
        ],
        "identifiers": []
      }
    }
  ]
  转换后，这两个文本节点被合并成一个复合表达式节点，结果如下：
  [
    {
      "type": 8,
      "children": [
        {
          "type": 2,
          "content": "hello ",
        },
        " + ",
        {
          "type": 5,
          "content": {
            "type": 8,
            "children": [
              {
                "type": 4,
                "isConstant": false,
                "content": "_ctx.msg",
                "isStatic": false
              },
              " + ",
              {
                "type": 4,
                "isConstant": false,
                "content": "_ctx.test",
                "isStatic": false
              }
            ],
            "identifiers": []
          }
        }
      ]
    }
  ]
  合并完子文本节点后，接着判断如果是一个只带有单个文本子元素的纯元素节点，则什么都不需要转换，因为这种情况在运行时可以直接设置元素的 textContent 来更新文本。
 * @param node
 * @param context
 */
export const transformText: NodeTransform = (node, context) => {
  if (
    node.type === NodeTypes.ROOT ||
    node.type === NodeTypes.ELEMENT ||
    node.type === NodeTypes.FOR ||
    node.type === NodeTypes.IF_BRANCH
  ) {
    // perform the transform on node exit so that all expressions have already
    // been processed.
    // 在节点退出时执行转换，保证所有表达式都已经被处理
    return () => {
      const children = node.children
      let currentContainer: CompoundExpressionNode | undefined = undefined
      let hasText = false

      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (isText(child)) {
          hasText = true
          for (let j = i + 1; j < children.length; j++) {
            // 将相邻文本节点合并
            const next = children[j]
            if (isText(next)) {
              if (!currentContainer) {
                // 创建复合表达式节点
                currentContainer = children[i] = {
                  type: NodeTypes.COMPOUND_EXPRESSION,
                  loc: child.loc,
                  children: [child]
                }
              }
              // merge adjacent text node into current
              currentContainer.children.push(` + `, next)
              children.splice(j, 1)
              j--
            } else {
              currentContainer = undefined
              break
            }
          }
        }
      }
      // 如果是一个带有单个文本子元素的纯元素节点，什么都不需要转换，因为这种情况在运行时可以直接设置元素的 textContent 来更新文本。
      if (
        !hasText ||
        // if this is a plain element with a single text child, leave it
        // as-is since the runtime has dedicated fast path for this by directly
        // setting textContent of the element.
        // for component root it's always normalized anyway.
        (children.length === 1 &&
          (node.type === NodeTypes.ROOT ||
            (node.type === NodeTypes.ELEMENT &&
              node.tagType === ElementTypes.ELEMENT)))
      ) {
        return
      }

      // pre-convert text nodes into createTextVNode(text) calls to avoid
      // runtime normalization.
      // 为子文本节点创建一个调用函数表达式的代码生成节点
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (isText(child) || child.type === NodeTypes.COMPOUND_EXPRESSION) {
          const callArgs: CallExpression['arguments'] = []
          // createTextVNode defaults to single whitespace, so if it is a
          // single space the code could be an empty call to save bytes.
          // 为 createTextVNode 添加执行参数
          if (child.type !== NodeTypes.TEXT || child.content !== ' ') {
            callArgs.push(child)
          }
          // mark dynamic text with flag so it gets patched inside a block
          // 标记动态文本
          if (!context.ssr && child.type !== NodeTypes.TEXT) {
            callArgs.push(
              `${PatchFlags.TEXT} /* ${PatchFlagNames[PatchFlags.TEXT]} */`
            )
          }
          children[i] = {
            type: NodeTypes.TEXT_CALL,
            content: child,
            loc: child.loc,
            codegenNode: createCallExpression(
              context.helper(CREATE_TEXT),
              callArgs
            )
          }
        }
      }
    }
  }
}
