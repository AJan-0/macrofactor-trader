import asyncio
from playwright.async_api import async_playwright

async def test():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={'width': 1280, 'height': 900})
        
        # Capture console logs
        logs = []
        page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))
        
        print('[1] Loading page...')
        await page.goto('http://localhost:5174/')
        await page.wait_for_selector('body', timeout=30000)
        await asyncio.sleep(8)
        
        print('[2] Opening strategy panel...')
        # Click strategy panel toggle
        strategy_toggle = await page.query_selector('text=/策略/')
        if strategy_toggle:
            await strategy_toggle.click()
            await asyncio.sleep(1)
        
        # Click "添加策略..." button
        add_btn = await page.query_selector('text=/添加策略/')
        if add_btn:
            await add_btn.click()
            await asyncio.sleep(1)
        
        # Select VWAP strategy
        vwap_option = await page.query_selector('text=/VWAP|Anchored/')
        if vwap_option:
            await vwap_option.click()
            await asyncio.sleep(3)
        
        await page.screenshot(path='test_1D_with_vwap_5174.png')
        print('[3] 1D with VWAP screenshot saved')
        
        # Check for strategy signals text
        signals_text = await page.query_selector('text=/signals.*lines/')
        if signals_text:
            txt = await signals_text.inner_text()
            print(f'    Strategy signals: {txt}')
        else:
            print('    No strategy signals text found')
        
        # Switch to 15m
        print('[4] Switching to 15m...')
        btn_15m = await page.query_selector('button:has-text("tf.15m")')
        if btn_15m:
            await btn_15m.click()
            await asyncio.sleep(10)
            await page.screenshot(path='test_15m_after_switch_5174.png')
            print('[5] 15m screenshot saved')
        else:
            print('    15m button not found!')
        
        # Check again for strategy signals
        signals_text2 = await page.query_selector('text=/signals.*lines/')
        if signals_text2:
            txt2 = await signals_text2.inner_text()
            print(f'    Strategy signals in 15m: {txt2}')
        else:
            print('    No strategy signals text found in 15m')
        
        # Print last 30 console logs
        print('\n--- Last 30 console logs ---')
        for log in logs[-30:]:
            print(log)
        
        await browser.close()
        print('Done!')

asyncio.run(test())
