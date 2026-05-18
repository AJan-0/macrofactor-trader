import asyncio
from playwright.async_api import async_playwright

async def test():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={'width': 1280, 'height': 900})
        logs = []
        page.on('console', lambda msg: logs.append(f'[{msg.type}] {msg.text}'))
        
        print('[1] Loading page...')
        await page.goto('http://localhost:8082/')
        await asyncio.sleep(12)
        
        # Click add strategy button by finding it in the DOM
        print('[2] Looking for add strategy button...')
        html = await page.content()
        has_add = '添加策略' in html
        print(f'    Page has 添加策略: {has_add}')
        
        # Try to find and click the strategy toggle to expand panel
        await page.evaluate("""() => {
            // Find all buttons and click ones that might expand strategy panel
            const btns = Array.from(document.querySelectorAll('button, [role=\"button\"]'));
            for (const b of btns) {
                const txt = b.textContent || '';
                if (txt.includes('策略') && (txt.includes('(') || b.closest('[class*="strategy"]'))) {
                    b.click();
                    return 'clicked: ' + txt.trim();
                }
            }
            return 'no strategy toggle found';
        }""")
        await asyncio.sleep(2)
        
        # Find and click add strategy
        result = await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button, [role=\"button\"], div, span'));
            for (const b of btns) {
                if (b.textContent && b.textContent.includes('添加策略')) {
                    b.click();
                    return 'clicked add strategy';
                }
            }
            return 'add strategy not found';
        }""")
        print(f'    {result}')
        await asyncio.sleep(2)
        
        # Try to find VWAP option
        result2 = await page.evaluate("""() => {
            const all = Array.from(document.querySelectorAll('*'));
            for (const el of all) {
                const txt = el.textContent || '';
                if (txt.includes('VWAP') && el.children.length === 0 && txt.length < 100) {
                    el.click();
                    return 'clicked VWAP: ' + txt.trim();
                }
            }
            // Print what's in the dropdown area
            const bodyText = document.body.innerText;
            const idx = bodyText.indexOf('添加策略');
            return 'VWAP not found. Context: ' + bodyText.slice(idx, idx + 300);
        }""")
        print(f'    {result2}')
        await asyncio.sleep(5)
        
        await page.screenshot(path='test_8082_1D.png')
        has_1d = await page.evaluate("""() => document.body.innerText.includes('signals')""")
        print(f'[3] 1D has signals: {has_1d}')
        
        # Switch to 15m
        print('[4] Switching to 15m...')
        await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const btn15m = btns.find(b => b.textContent.includes('15m'));
            if (btn15m) { btn15m.click(); return 'clicked 15m'; }
            return '15m not found';
        }""")
        await asyncio.sleep(12)
        await page.screenshot(path='test_8082_15m.png')
        
        has_15m = await page.evaluate("""() => document.body.innerText.includes('signals')""")
        print(f'[5] 15m has signals: {has_15m}')
        
        # Print relevant console logs
        print('\n--- Relevant logs ---')
        for log in logs:
            if '15m' in log or 'signals' in log or 'Loaded' in log or 'error' in log.lower():
                print(log)
        
        await browser.close()
        print('Done!')

asyncio.run(test())
