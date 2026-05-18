import asyncio
from playwright.async_api import async_playwright

VWAP_STATE = '[{"id":"zeiierman-vwap","params":{"prd":50,"baseAPT":20,"useAdapt":false,"volBias":10,"upColor":"#22c55e","downColor":"#ef4444","lineWidth":2}}]'

async def test():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()
        page.set_viewport_size({'width': 1280, 'height': 900})
        
        logs = []
        page.on('console', lambda msg: logs.append(f'[{msg.type}] {msg.text}'))
        
        # Set localStorage via init script before any navigation
        await page.add_init_script(f"""
            localStorage.setItem('chartStrategies', '{VWAP_STATE}');
        """)
        
        print('[1] Loading page with pre-set VWAP strategy...')
        await page.goto('http://localhost:8082/')
        await asyncio.sleep(12)
        await page.screenshot(path='test_final_1D.png')
        
        has_1d = await page.evaluate("""() => document.body.innerText.includes('signals')""")
        print(f'[2] 1D has signals: {has_1d}')
        
        strat_count = await page.evaluate("""() => {
            const text = document.body.innerText;
            const match = text.match(/策略\s*\((\d+)\)/);
            return match ? match[1] : 'not found';
        }""")
        print(f'    Strategy count: {strat_count}')
        
        # Switch to 15m
        print('[3] Switching to 15m...')
        await page.evaluate("""() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const btn15m = btns.find(b => b.textContent.includes('15m'));
            if (btn15m) btn15m.click();
        }""")
        await asyncio.sleep(12)
        await page.screenshot(path='test_final_15m.png')
        
        has_15m = await page.evaluate("""() => document.body.innerText.includes('signals')""")
        print(f'[4] 15m has signals: {has_15m}')
        
        strat_count_15m = await page.evaluate("""() => {
            const text = document.body.innerText;
            const match = text.match(/策略\s*\((\d+)\)/);
            return match ? match[1] : 'not found';
        }""")
        print(f'    Strategy count: {strat_count_15m}')
        
        print('\n--- Relevant logs ---')
        for log in logs:
            if '15m' in log or 'signals' in log or 'Loaded' in log or 'Worker' in log or 'Strategy' in log or 'error' in log.lower():
                print(log)
        
        await browser.close()
        print('Done!')

asyncio.run(test())
