!function(a){function b(d){if(c[d])return c[d].exports;var e=c[d]={exports:{},id:d,loaded:!1};return a[d].call(e.exports,e,e.exports,b),e.loaded=!0,e.exports}var c={};b.m=a,b.c=c,b.p="",b(0)}({0:function(a,b,c){a.exports=c(15)},15:function(a,b){"use strict";!function(){function a(a){if(a.hasAttribute(b)){var c=a.getAttribute(b);return chrome.i18n.getMessage(c)||"["+c+"]"}}var b="key",c=Object.create(HTMLSpanElement.prototype);c.createdCallback=function(){(this.shadowRoot||this.createShadowRoot()).appendChild(document.createTextNode(a(this)))},c.attributeChangedCallback=function(b,c,d){var e=this.shadowRoot||this.createShadowRoot();e.innerHTML="",e.appendChild(document.createTextNode(a(this)))},document.registerElement("aurainspector-label",{prototype:c})}()}});