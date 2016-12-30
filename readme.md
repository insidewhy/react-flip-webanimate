# react-flip-webanimate

Much like [react-flip-move](https://github.com/joshwcomeau/react-flip-move) but uses WebAnimations API.

The advantages to this are:
 * Library user can programatically set advanced leave/enter/move animations.
 * Simpler code, much easier event handling than without WebAnimations.

The disadvantages are:
 * WebAnimations currently seem slower than the css transitions used by other techniques.

To work around WebAnimations being slower this library is able to limit animations to nodes scrolled into view.

This library is currently used by [kchomp](http://kchomp.co) but needs a little more work until it is ready for general use.
