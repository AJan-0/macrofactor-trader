import asyncio
from playwright.async_api import async_playwright

async def test():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={'width': 1280, 'height': 900})
        
        print('[1] Loading page...')
        await page.goto('http://localhost:5174/')
        
        # Wait for body to be ready
        await page.wait_for_selector('body', timeout=30000)
        print('[2] Body loaded')
        
        # Wait a bit for React to render
        await asyncio.sleep(10)
        await page.screenshot(path='test_debug_5174.png')
        print('[3] Screenshot saved')
        
        # Check if chart container exists
        chart = await page.query_selector('.tv-chart-container')
        print(f'[4] Chart container exists: {chart is not None}')
        
        # Check page title
        title = await page.title()
        print(f'[5] Page title: {title}')
        
        await browser.close()
        print('Done!')

asyncio.run(test())
