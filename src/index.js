import React, {Component} from 'react'
import ReactDom from 'react-dom'

import _ from 'lodash'

const stopAnimation = nodeData => {
  const {animation} = nodeData
  if (animation) {
    animation.cancel()
    delete nodeData.animation
  }
}

const hasWebAnimations = !! document.createElement('div').animate

const setBoundingRect = (child, domRect) => {
  const {node} = child
  if (! node)
    return
  // this doesn't factor in transforms that may be happening
  // child.top = child.node.offsetTop
  const rect = node.getBoundingClientRect()
  // +1 to account for the negative margin...
  child.top = rect.top - domRect.top + 1
  child.left = rect.left - domRect.left
  child.bottom = rect.bottom - domRect.top + 1
}

const getBoundingRect = (node, domRect) => {
  const rect = node.getBoundingClientRect()
  return {
    top: rect.top - domRect.top + 1,
    left: rect.left - domRect.left,
    bottom: rect.bottom - domRect.top + 1,
  }
}


export default class FlipMove extends Component {
  constructor() {
    super()
    this.state = { enabled: hasWebAnimations }
    // all non-deleting child elements by key
    this._children = null
    // child elements that are deleting by key
    this._deleting = {}
  }

  render() {
    const {typeName, enterAnimation, leaveAnimation, duration, ...props} = this.props
    if (! this.state.enabled)
      return React.createElement(typeName, props, props.children)

    delete props.children
    this._duration = +duration
    this._enterAnimation = enterAnimation
    this._leaveAnimation = leaveAnimation

    return React.createElement(typeName, props, this.state.children)
  }

  _createElement(element) {
    const ret = {}
    ret.element = React.cloneElement(element, {
      ref: refElement => {
        const node = ReactDom.findDOMNode(refElement)
        if (node)
          ret.node = node
      },
    })
    return ret
  }

  _initComponent(children) {
    this._children = _.mapValues(_.keyBy(children, 'key'), element => this._createElement(element))
    this.setState({ children: _.map(this._children, 'element') })
  }

  _getDom() {
    return this._dom || (this._dom = ReactDom.findDOMNode(this))
  }

  componentWillMount() {
    if (! this.state.enabled)
      return
    this._initComponent(this.props.children)
  }

  componentWillReceiveProps(props) {
    if (! this.state.enabled)
      return

    if (this.props.children === props.children)
      return

    this._hasNewProps = true
    const _dom = this._getDom()
    if (! this._children) {
      this._initComponent(props.children)
    }
    else {
      const newChildren = {}
      const domRect = _dom.getBoundingClientRect()

      props.children.forEach(element => {
        const {key} = element
        const existing = this._children[key]
        if (existing) {
          newChildren[key] = existing
          // recalculate bounding rectangle for existing node
          setBoundingRect(existing, domRect)
          return
        }

        const deleting = this._deleting[key]
        if (deleting) {
          newChildren[key] = deleting
          setBoundingRect(deleting, domRect)
          stopAnimation(deleting)
          this._returnNodeToFlow(deleting)
          delete this._deleting[key]
        }
        else {
          newChildren[key] = this._createElement(element)
        }
      })

      _.forEach(this._children, (child, key) => {
        if (! newChildren[key]) {
          setBoundingRect(child, domRect)
          this._deleting[key] = child
        }
      })
      this._children = newChildren
      this._setChildren()
    }

    this._updateToken = Symbol()
    const {scrollTop = document.body.scrollTop} = document.documentElement
    this._dom.style.minHeight = (scrollTop + window.innerHeight) + 'px'
  }

  _setChildren() {
    // the deletes must come after the rest so they don't interfere with the positions of other nodes
    this.setState({ children: _.map(this._children, 'element').concat(_.map(this._deleting, 'element')) })
  }

  componentDidUpdate() {
    // avoid testing stuff when only state has changed
    if (!  this._hasNewProps)
      return

    const {scrollTop = document.body.scrollTop} = document.documentElement
    const domBoundingRect = this._dom.getBoundingClientRect()
    const maxHeight = window.innerHeight - domBoundingRect.top + scrollTop
    const width = this._dom.clientWidth

    let nLeavesLeft = 0
    let updateToken = this._updateToken
    const leaveAnimationOver = () => {
      if (this._updateToken !== updateToken)
        return

      if (--nLeavesLeft <= 0) {
        // console.debug('all animations finished')
        this._dom.style.minHeight = ''
      }
    }

    _.forEach(this._children, (data, key) => {
      const {node} = data
      if (! node)
        return

      const rect = getBoundingRect(node, domBoundingRect)
      if (data.animation) {
        if (data.animateToTop === rect.top && data.animateToLeft === rect.left) {
          // already animating to this location
          return
        }
        data.animation.cancel()
        delete data.animation
      }

      if (data.hasOwnProperty('top')) {
        // move from previous position
        const deltaX = data.left - rect.left
        const deltaY = data.top - rect.top

        if (deltaX !== 0 || deltaY !== 0) {
          // move node from current position to new position (if necessary)
          data.animateToTop = rect.top
          data.animateToLeft = rect.left
          data.animation = node.animate(
            [{ transform: `translate(${deltaX}px, ${deltaY}px)` }, { transform: `translate(0, 0)` }],
            // fill forwards is needed to compensate for delayed onfinish in firefox
            { duration: this._duration, easing: 'ease-in' }
          )
        }
      }
      else {
        // only animate nodes on screen
        if (rect.bottom < scrollTop || rect.top > maxHeight)
          return

        data.animateToTop = rect.top
        data.animateToLeft = rect.left - width
        // child has no recorded position so must be an entry
        data.animation = node.animate(
          [{ transform: `translateX(-${width}px)` }, { transform: `translateX(0)` }],
          { duration: this._duration, easing: 'ease-in' }
        )
      }
    })

    let hasImmediateLeaves = false
    _.forEach(this._deleting, (data, key) => {
      const {animation: existingAnimation} = data
      const finalX = data.left < 0 ? -width : width
      const newLeft = data.width + finalX

      if (existingAnimation &&
          data.animateToTop === data.top &&
          data.animateToLeft === newLeft)
        return

      const {node} = data
      // avoid animations for stuff scrolled off screen ;)
      if (data.bottom < scrollTop || data.top > maxHeight) {
        node.style.display = 'none'
        delete this._deleting[key]
        hasImmediateLeaves = true
        return
      }

      this._takeNodeOutOfFlow(data)
      data.animateToTop = data.top
      data.animateToLeft = newLeft

      const animation = data.animation = node.animate(
        [{ transform: `translateX(${data.left}px)` }, { transform: `translateX(${finalX}px)` }],
        // fill forwards is needed to compensate for delayed onfinish in firefox
        { duration: this._duration, easing: 'ease-in', fill: 'forwards' }
      )
      ++nLeavesLeft

      animation.onfinish = () => {
        node.style.display = 'none'
        delete this._deleting[key]
        this._setChildren()
        leaveAnimationOver()
      }

      animation.oncancel = leaveAnimationOver
    })

    if (hasImmediateLeaves)
      this._setChildren()

    if (! nLeavesLeft)
      leaveAnimationOver()

    this._hasNewProps = false
  }

  _takeNodeOutOfFlow(data) {
    const {node} = data
    node.style.position = 'absolute'
    node.style.top = data.top + 'px'
  }

  _returnNodeToFlow(data) {
    const {node} = data
    node.style.position = ''
    node.style.top = ''
  }
}
