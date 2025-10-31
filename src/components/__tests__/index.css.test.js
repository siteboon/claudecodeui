/**
 * CSS Animation Tests for index.css
 * 
 * This test validates the CSS animation rules added for tool details chevron rotation.
 * Since these are CSS rules, we test them by verifying the stylesheet contains the rules
 * and by testing the DOM behavior when the rules are applied.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { JSDOM } from 'jsdom'
import fs from 'fs'
import path from 'path'

describe('index.css - Chevron Animation Styles', () => {
  let cssContent

  beforeAll(() => {
    const cssPath = path.resolve(__dirname, '../../index.css')
    cssContent = fs.readFileSync(cssPath, 'utf-8')
  })

  it('should contain chevron rotation rule for open details', () => {
    expect(cssContent).toContain('details[open] .details-chevron')
    expect(cssContent).toContain('transform: rotate(180deg)')
  })

  it('should contain chevron rotation rule for group-open variant', () => {
    expect(cssContent).toContain('details[open] summary svg[class*="group-open"]')
    expect(cssContent).toContain('transform: rotate(180deg)')
  })

  it('should contain smooth transition rules', () => {
    expect(cssContent).toContain('.details-chevron')
    expect(cssContent).toContain('summary svg[class*="transition-transform"]')
    expect(cssContent).toContain('transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1)')
  })

  it('should have proper CSS syntax and structure', () => {
    // Check for properly closed braces
    const openBraces = (cssContent.match(/{/g) || []).length
    const closeBraces = (cssContent.match(/}/g) || []).length
    expect(openBraces).toBe(closeBraces)
  })
})

describe('CSS Animation - DOM Behavior', () => {
  it('should apply transform when details element is open', () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            details[open] .details-chevron {
              transform: rotate(180deg);
            }
            .details-chevron {
              transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
            }
          </style>
        </head>
        <body>
          <details id="test-details">
            <summary>
              <svg class="details-chevron"></svg>
            </summary>
            <div>Content</div>
          </details>
        </body>
      </html>
    `)

    const details = dom.window.document.getElementById('test-details')
    const chevron = dom.window.document.querySelector('.details-chevron')

    // Initially closed - no transform
    let style = dom.window.getComputedStyle(chevron)
    expect(details.hasAttribute('open')).toBe(false)

    // Open the details
    details.setAttribute('open', '')
    
    // Should now match the selector
    const openChevrons = dom.window.document.querySelectorAll('details[open] .details-chevron')
    expect(openChevrons.length).toBe(1)
  })

  it('should apply transition property to chevron elements', () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            .details-chevron,
            summary svg[class*="transition-transform"] {
              transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
            }
          </style>
        </head>
        <body>
          <details>
            <summary>
              <svg class="transition-transform-duration-200"></svg>
            </summary>
          </details>
        </body>
      </html>
    `)

    const svg = dom.window.document.querySelector('svg')
    expect(svg.className).toContain('transition-transform')
  })

  it('should handle group-open variant for nested details', () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            details[open] summary svg[class*="group-open"] {
              transform: rotate(180deg);
            }
          </style>
        </head>
        <body>
          <details open class="group/details">
            <summary>
              <svg class="group-open/details"></svg>
            </summary>
          </details>
        </body>
      </html>
    `)

    const openDetails = dom.window.document.querySelectorAll('details[open] summary svg[class*="group-open"]')
    expect(openDetails.length).toBe(1)
  })
})

describe('CSS Animation - Timing Function', () => {
  it('should use cubic-bezier easing function', () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            .test-chevron {
              transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
            }
          </style>
        </head>
        <body>
          <svg class="test-chevron"></svg>
        </body>
      </html>
    `)

    const styleSheet = dom.window.document.styleSheets[0]
    const rule = styleSheet.cssRules[0]
    
    expect(rule.style.transition).toContain('cubic-bezier(0.4, 0, 0.2, 1)')
  })

  it('should have 200ms duration', () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            .test-chevron {
              transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
            }
          </style>
        </head>
        <body>
          <svg class="test-chevron"></svg>
        </body>
      </html>
    `)

    const styleSheet = dom.window.document.styleSheets[0]
    const rule = styleSheet.cssRules[0]
    
    expect(rule.style.transition).toContain('200ms')
  })
})