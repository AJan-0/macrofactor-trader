import asyncio
from playwright.async_api import async_playwright

async def test():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={'width': 1280, 'height': 900})
        
        logs = []
        page.on('console', lambda msg: logs.append(f'[{msg.type}] {msg.text}'))
        
        await page.goto('http://localhost:5174/')
        await asyncio.sleep(10)
        
        # Click add strategy button
        await page.evaluate("""() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const addBtn = buttons.find(b => b.textContent.includes('添加策略'));
            if (addBtn) { addBtn.click(); return 'clicked'; }
            return 'not found';
        }""")
        await asyncio.sleep(2)
        
        # Click VWAP
        result = await page.evaluate("""() => {
            const items = Array.from(document.querySelectorAll('*'));
            const vwap = items.find(el => el.textContent && el.textContent.includes('VWAP') && el.tagName !== 'SCRIPT');
            if (vwap) { vwap.click(); return 'clicked: ' + vwap.textContent.trim(); }
            return 'not found';
        }""")
        print('Strategy select:', result)
        await asyncio.sleep(5)
        await page.screenshot(path='test_1D_vwap_5174.png')
        
        # Check signals on 1D
        has_signals_1d = await page.evaluate("""() => document.body.innerText.includes('signals')""")
        print('1D has signals:', has_signals_1d)
        
        # Switch to 15m
        await page.evaluate("""() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const btn15m = buttons.find(b => b.textContent.includes('15m'));
            if (btn15m) { btn15m.click(); return 'clicked 15m'; }
            return '15m not found';
        }""")
        await asyncio.sleep(12)
        await page.screenshot(path='test_15m_vwap_5174.png')
        
        # Check signals on 15m
        has_signals_15m = await page.evaluate("""() => document.body.innerText.includes('signals')""")
        print('15m has signals:', has_signals_15m)
        
        print('\n--- Console logs (last 60) ---')
        for log in logs[-60:]:
            print(log)
        
        await browser.close()

asyncio.run(test())
