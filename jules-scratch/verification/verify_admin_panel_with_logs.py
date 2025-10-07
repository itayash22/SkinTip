from playwright.sync_api import sync_playwright, expect

def verify_admin_panel_with_logs(page):
    """
    This script verifies the admin panel and captures console logs for debugging.
    """
    # Listen for all console events and print them
    page.on("console", lambda msg: print(f"Browser console: {msg.text}"))

    # 1. Navigate to the application
    page.goto("http://localhost:8080")

    # 2. Find and click the "Admin" button
    admin_button = page.locator("#adminBtn")
    expect(admin_button).to_be_visible()
    admin_button.click()

    # 3. Assert that the admin section has the correct display style
    admin_section = page.locator("#adminSection")
    expect(admin_section).to_have_css("display", "block")

    # 4. Take a screenshot for visual confirmation
    page.screenshot(path="jules-scratch/verification/admin_panel_verification.png")
    print("Successfully captured screenshot of the admin panel.")

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_admin_panel_with_logs(page)
        finally:
            browser.close()

if __name__ == "__main__":
    main()
