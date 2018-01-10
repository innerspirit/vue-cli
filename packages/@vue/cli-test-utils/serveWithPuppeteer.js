const launchPuppeteer = require('./launchPuppeteer')

module.exports = async function serveWithPuppeteer (serve, test) {
  let activeBrowser
  let activeChild

  let notifyUpdate
  const nextUpdate = () => {
    return new Promise(resolve => {
      notifyUpdate = resolve
    })
  }

  await new Promise((resolve, reject) => {
    const child = activeChild = serve()

    const exit = async (err) => {
      if (activeBrowser) {
        await activeBrowser.close()
        activeBrowser = null
      }
      if (activeChild) {
        activeChild.stdin.write('close')
        activeBrowser = null
      }
      reject(err)
    }

    let isFirstMatch = true
    child.stdout.on('data', async (data) => {
      data = data.toString()
      try {
        const urlMatch = data.match(/http:\/\/[^/]+\//)
        if (urlMatch && isFirstMatch) {
          isFirstMatch = false
          // start browser
          const url = urlMatch[0]
          const { page, browser } = await launchPuppeteer(url)
          activeBrowser = browser

          const helpers = createHelpers(page)

          await test({
            browser,
            page,
            url,
            nextUpdate,
            helpers
          })

          await browser.close()
          activeBrowser = null
          // on appveyor, the spawned server process doesn't exit
          // and causes the build to hang.
          child.stdin.write('close')
          activeChild = null
          // kill(child.pid)
          resolve()
        } else if (data.match(/App updated/)) {
          if (notifyUpdate) {
            notifyUpdate(data)
          }
        } else if (data.match(/Failed to compile/)) {
          exit(data)
        }
      } catch (err) {
        exit(err)
      }
    })

    child.on('exit', code => {
      activeChild = null
      if (code !== 0) {
        reject(`serve exited with code ${code}`)
      }
    })
  })
}

function createHelpers (page) {
  return {
    getText: selector => page.evaluate(selector => {
      return document.querySelector(selector).textContent
    }, selector),

    hasElement: selector => page.evaluate(selector => {
      return !!document.querySelector(selector)
    }, selector),

    hasClass: (selector, cls) => page.evaluate((selector, cls) => {
      const el = document.querySelector(selector)
      return el && el.classList.contains(cls)
    }, selector, cls)
  }
}