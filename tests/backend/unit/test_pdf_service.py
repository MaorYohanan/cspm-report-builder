"""
Unit tests for PDFService.

Tests cover:
- HTML rendering (pass-through)
- Header template generation with various metadata combinations
- Footer template generation with various metadata combinations
- PDF rendering with mocked Playwright
"""

from pathlib import Path
from unittest.mock import MagicMock, Mock, patch, mock_open, call
import pytest

from backend.services.pdf_service import PDFService


class TestPDFServiceInit:
    """Test PDFService initialization."""

    def test_init_without_template_dir(self):
        """Test initialization without template directory."""
        service = PDFService()
        assert service.template_dir is None

    def test_init_with_template_dir_string(self):
        """Test initialization with template directory as string."""
        service = PDFService("/path/to/templates")
        assert service.template_dir == Path("/path/to/templates")

    def test_init_with_template_dir_path(self):
        """Test initialization with template directory as Path."""
        template_path = Path("/path/to/templates")
        service = PDFService(template_path)
        assert service.template_dir == template_path


class TestRenderHTML:
    """Test the render_html method."""

    def test_render_html_returns_input(self):
        """Test that render_html returns the input HTML as-is."""
        service = PDFService()
        html_content = "<html><body><h1>Test Report</h1></body></html>"
        meta = {"client": "Test Client", "env": "Production"}

        result = service.render_html(html_content, meta)

        assert result == html_content

    def test_render_html_with_empty_string(self):
        """Test render_html with empty HTML content."""
        service = PDFService()
        result = service.render_html("", {})
        assert result == ""

    def test_render_html_with_complex_html(self):
        """Test render_html with complex HTML structure."""
        service = PDFService()
        complex_html = """
        <!DOCTYPE html>
        <html>
        <head><title>Complex Report</title></head>
        <body>
            <div class="finding-card">
                <h2>Finding 1</h2>
                <p>Details here</p>
            </div>
        </body>
        </html>
        """
        meta = {"reportDate": "01/01/2026"}

        result = service.render_html(complex_html, meta)

        assert result == complex_html


class TestBuildHeader:
    """Test the _build_header method."""

    def test_build_header_with_all_fields(self):
        """Test header generation with all metadata fields provided."""
        service = PDFService()
        meta = {
            "client": "Acme Corp",
            "env": "Production",
            "reportDate": "31/05/2026",
            "consultant": "John Doe",
            "teamName": "Security Team"
        }

        header = service._build_header(meta)

        assert "Acme Corp" in header
        assert "Production" in header
        assert "31/05/2026" in header
        assert "John Doe" in header
        assert "Security Team" in header
        assert "תאריך הדו״ח:" in header

    def test_build_header_with_missing_fields(self):
        """Test header generation with missing metadata fields."""
        service = PDFService()
        meta = {}

        header = service._build_header(meta)

        assert "__________" in header  # Default for client
        assert "DD/MM/YYYY" in header  # Default for reportDate
        assert "CSPM Report" in header  # Default for teamName

    def test_build_header_with_partial_fields(self):
        """Test header generation with some fields missing."""
        service = PDFService()
        meta = {
            "client": "Test Client",
            "reportDate": "15/03/2026"
        }

        header = service._build_header(meta)

        assert "Test Client" in header
        assert "15/03/2026" in header
        assert "__________" in header  # Default for env
        assert "CSPM Report" in header  # Default for teamName

    def test_build_header_with_none_values(self):
        """Test header generation with None values."""
        service = PDFService()
        meta = {
            "client": None,
            "env": None,
            "reportDate": None,
            "consultant": None,
            "teamName": None
        }

        header = service._build_header(meta)

        assert "__________" in header
        assert "DD/MM/YYYY" in header
        assert "CSPM Report" in header

    def test_build_header_html_structure(self):
        """Test that header contains proper HTML structure."""
        service = PDFService()
        meta = {"client": "Test", "env": "Dev"}

        header = service._build_header(meta)

        assert "<div" in header
        assert "style=" in header
        assert "font-family:Arial" in header
        assert "display:flex" in header
        assert "border-bottom" in header

    def test_build_header_special_characters(self):
        """Test header generation with special characters in fields."""
        service = PDFService()
        meta = {
            "client": "Client & Co.",
            "env": "Staging/Test",
            "consultant": "O'Brien"
        }

        header = service._build_header(meta)

        assert "Client & Co." in header
        assert "Staging/Test" in header
        assert "O'Brien" in header


class TestBuildFooter:
    """Test the _build_footer method."""

    def test_build_footer_with_all_fields(self):
        """Test footer generation with all metadata fields provided."""
        service = PDFService()
        meta = {
            "reportDate": "31/05/2026",
            "footerText": "Confidential - Internal Use Only"
        }

        footer = service._build_footer(meta)

        assert "31/05/2026" in footer
        assert "Confidential - Internal Use Only" in footer
        assert "תאריך הדו״ח:" in footer
        assert "עמוד" in footer
        assert "pageNumber" in footer
        assert "totalPages" in footer

    def test_build_footer_with_missing_fields(self):
        """Test footer generation with missing metadata fields."""
        service = PDFService()
        meta = {}

        footer = service._build_footer(meta)

        assert "DD/MM/YYYY" in footer  # Default for reportDate

    def test_build_footer_with_none_values(self):
        """Test footer generation with None values."""
        service = PDFService()
        meta = {
            "reportDate": None,
            "footerText": None
        }

        footer = service._build_footer(meta)

        assert "DD/MM/YYYY" in footer

    def test_build_footer_html_structure(self):
        """Test that footer contains proper HTML structure."""
        service = PDFService()
        meta = {"reportDate": "01/01/2026"}

        footer = service._build_footer(meta)

        assert "<div" in footer
        assert "style=" in footer
        assert "font-family:Arial" in footer
        assert "display:flex" in footer
        assert "border-top" in footer
        assert 'class="pageNumber"' in footer
        assert 'class="totalPages"' in footer

    def test_build_footer_special_characters(self):
        """Test footer generation with special characters."""
        service = PDFService()
        meta = {
            "footerText": "© 2026 Company & Partners"
        }

        footer = service._build_footer(meta)

        assert "© 2026 Company & Partners" in footer


class TestRenderPDF:
    """Test the render_pdf method with mocked Playwright."""

    @patch('backend.services.pdf_service.sync_playwright')
    @patch('backend.services.pdf_service.tempfile.TemporaryDirectory')
    def test_render_pdf_success(self, mock_temp_dir, mock_playwright):
        """Test successful PDF rendering."""
        # Setup temp directory mock
        mock_temp_dir.return_value.__enter__.return_value = "/tmp/test"

        # Mock Playwright
        mock_browser = MagicMock()
        mock_page = MagicMock()
        mock_browser.new_page.return_value = mock_page

        mock_playwright_instance = MagicMock()
        mock_playwright_instance.chromium.launch.return_value = mock_browser
        mock_playwright.return_value.__enter__.return_value = mock_playwright_instance

        # Test
        service = PDFService()
        html_content = "<html><body>Test</body></html>"
        meta = {"client": "Test", "reportDate": "01/01/2026"}

        # We need to actually create the PDF file in the temp directory for this to work
        # Since we're mocking, we'll patch Path.read_bytes to return our test content
        with patch('backend.services.pdf_service.Path') as mock_path_class:
            mock_html_path = MagicMock()
            mock_pdf_path = MagicMock()
            mock_pdf_path.read_bytes.return_value = b"PDF content"

            def path_constructor(path):
                mock_obj = MagicMock()
                mock_obj.__truediv__ = lambda self, other: (
                    mock_html_path if "report.html" in str(other)
                    else mock_pdf_path if "report.pdf" in str(other)
                    else MagicMock()
                )
                mock_obj.write_text = MagicMock()
                mock_obj.as_uri = MagicMock(return_value="file:///tmp/test/report.html")
                return mock_obj

            mock_path_class.side_effect = path_constructor

            result = service.render_pdf(html_content, meta)

            # Assertions
            assert result == b"PDF content"
            mock_browser.new_page.assert_called_once()
            mock_page.goto.assert_called_once()
            mock_page.add_style_tag.assert_called_once()
            mock_page.pdf.assert_called_once()
            mock_browser.close.assert_called_once()

    @patch('backend.services.pdf_service.sync_playwright')
    @patch('backend.services.pdf_service.tempfile.TemporaryDirectory')
    def test_render_pdf_with_custom_metadata(self, mock_temp_dir, mock_playwright):
        """Test PDF rendering with custom metadata for header/footer."""
        # Setup temp directory
        mock_temp_dir.return_value.__enter__.return_value = "/tmp/test"

        # Mock Playwright
        mock_browser = MagicMock()
        mock_page = MagicMock()
        mock_browser.new_page.return_value = mock_page

        mock_playwright_instance = MagicMock()
        mock_playwright_instance.chromium.launch.return_value = mock_browser
        mock_playwright.return_value.__enter__.return_value = mock_playwright_instance

        # Test
        service = PDFService()
        html_content = "<html><body>Test Report</body></html>"
        meta = {
            "client": "Custom Client",
            "env": "Staging",
            "reportDate": "15/05/2026",
            "consultant": "Jane Smith",
            "teamName": "Custom Team",
            "footerText": "Custom Footer"
        }

        with patch('backend.services.pdf_service.Path') as mock_path_class:
            mock_pdf_path = MagicMock()
            mock_pdf_path.read_bytes.return_value = b"PDF with metadata"

            def path_constructor(path):
                mock_obj = MagicMock()
                mock_obj.__truediv__ = lambda self, other: mock_pdf_path if "pdf" in str(other) else MagicMock()
                mock_obj.write_text = MagicMock()
                mock_obj.as_uri = MagicMock(return_value="file:///tmp/test/report.html")
                return mock_obj

            mock_path_class.side_effect = path_constructor

            result = service.render_pdf(html_content, meta)

            # Verify PDF was generated
            assert result == b"PDF with metadata"

            # Verify pdf() was called with proper arguments
            pdf_call_args = mock_page.pdf.call_args
            assert pdf_call_args[1]["format"] == "A4"
            assert pdf_call_args[1]["print_background"] is True
            assert pdf_call_args[1]["display_header_footer"] is True
            assert "Custom Client" in pdf_call_args[1]["header_template"]
            assert "Custom Footer" in pdf_call_args[1]["footer_template"]

    @patch('backend.services.pdf_service.sync_playwright')
    @patch('backend.services.pdf_service.tempfile.TemporaryDirectory')
    def test_render_pdf_html_write_failure(self, mock_temp_dir, mock_playwright):
        """Test PDF rendering when HTML write fails."""
        mock_temp_dir.return_value.__enter__.return_value = "/tmp/test"

        service = PDFService()

        with patch('backend.services.pdf_service.Path') as mock_path_class:
            mock_html_path = MagicMock()
            mock_html_path.write_text.side_effect = IOError("Write failed")

            def path_constructor(path):
                mock_obj = MagicMock()
                mock_obj.__truediv__ = lambda self, other: mock_html_path if "html" in str(other) else MagicMock()
                return mock_obj

            mock_path_class.side_effect = path_constructor

            with pytest.raises(RuntimeError, match="Failed to write HTML file"):
                service.render_pdf("<html></html>", {})

    @patch('backend.services.pdf_service.sync_playwright')
    @patch('backend.services.pdf_service.tempfile.TemporaryDirectory')
    @patch('backend.services.pdf_service.Path')
    def test_render_pdf_browser_launch_failure(self, mock_path_class, mock_temp_dir, mock_playwright):
        """Test PDF rendering when browser launch fails."""
        from playwright.sync_api import Error as PlaywrightError

        mock_temp_dir.return_value.__enter__.return_value = "/tmp/test"

        mock_html_path = MagicMock()
        mock_pdf_path = MagicMock()

        def path_side_effect(path):
            if "report.html" in str(path):
                return mock_html_path
            elif "report.pdf" in str(path):
                return mock_pdf_path
            return MagicMock()

        mock_path_class.side_effect = path_side_effect

        # Mock Playwright to fail on launch
        mock_playwright_instance = MagicMock()
        mock_playwright_instance.chromium.launch.side_effect = PlaywrightError("Launch failed")
        mock_playwright.return_value.__enter__.return_value = mock_playwright_instance

        service = PDFService()

        with pytest.raises(RuntimeError, match="Failed to launch Chromium browser"):
            service.render_pdf("<html></html>", {})

    @patch('backend.services.pdf_service.sync_playwright')
    @patch('backend.services.pdf_service.tempfile.TemporaryDirectory')
    @patch('backend.services.pdf_service.Path')
    def test_render_pdf_pdf_generation_failure(self, mock_path_class, mock_temp_dir, mock_playwright):
        """Test PDF rendering when PDF generation fails."""
        from playwright.sync_api import Error as PlaywrightError

        mock_temp_dir.return_value.__enter__.return_value = "/tmp/test"

        mock_html_path = MagicMock()
        mock_pdf_path = MagicMock()

        def path_side_effect(path):
            if "report.html" in str(path):
                return mock_html_path
            elif "report.pdf" in str(path):
                return mock_pdf_path
            return MagicMock()

        mock_path_class.side_effect = path_side_effect

        # Mock Playwright
        mock_browser = MagicMock()
        mock_page = MagicMock()
        mock_page.pdf.side_effect = PlaywrightError("PDF generation failed")
        mock_browser.new_page.return_value = mock_page

        mock_playwright_instance = MagicMock()
        mock_playwright_instance.chromium.launch.return_value = mock_browser
        mock_playwright.return_value.__enter__.return_value = mock_playwright_instance

        service = PDFService()

        with pytest.raises(RuntimeError, match="PDF generation failed"):
            service.render_pdf("<html></html>", {})

        # Verify browser cleanup was attempted
        mock_browser.close.assert_called_once()

    @patch('backend.services.pdf_service.sync_playwright')
    @patch('backend.services.pdf_service.tempfile.TemporaryDirectory')
    def test_render_pdf_read_failure(self, mock_temp_dir, mock_playwright):
        """Test PDF rendering when reading generated PDF fails."""
        mock_temp_dir.return_value.__enter__.return_value = "/tmp/test"

        # Mock Playwright
        mock_browser = MagicMock()
        mock_page = MagicMock()
        mock_browser.new_page.return_value = mock_page

        mock_playwright_instance = MagicMock()
        mock_playwright_instance.chromium.launch.return_value = mock_browser
        mock_playwright.return_value.__enter__.return_value = mock_playwright_instance

        service = PDFService()

        with patch('backend.services.pdf_service.Path') as mock_path_class:
            mock_html_path = MagicMock()
            mock_pdf_path = MagicMock()
            mock_pdf_path.read_bytes.side_effect = IOError("Read failed")

            def path_constructor(path):
                mock_obj = MagicMock()
                def truediv(self, other):
                    result = MagicMock()
                    if "report.html" in str(other):
                        result.write_text = MagicMock()
                        result.as_uri = MagicMock(return_value="file:///tmp/test/report.html")
                        return result
                    elif "report.pdf" in str(other):
                        return mock_pdf_path
                    return MagicMock()
                mock_obj.__truediv__ = truediv
                return mock_obj

            mock_path_class.side_effect = path_constructor

            with pytest.raises(RuntimeError, match="Failed to read generated PDF"):
                service.render_pdf("<html></html>", {})

    @patch('backend.services.pdf_service.sync_playwright')
    @patch('backend.services.pdf_service.tempfile.TemporaryDirectory')
    @patch('backend.services.pdf_service.Path')
    def test_render_pdf_calls_evaluate_for_cleanup(self, mock_path_class, mock_temp_dir, mock_playwright):
        """Test that render_pdf calls page.evaluate to remove header/footer elements."""
        mock_temp_dir.return_value.__enter__.return_value = "/tmp/test"

        mock_html_path = MagicMock()
        mock_pdf_path = MagicMock()
        mock_pdf_path.read_bytes.return_value = b"PDF content"

        def path_side_effect(path):
            if "report.html" in str(path):
                return mock_html_path
            elif "report.pdf" in str(path):
                return mock_pdf_path
            return MagicMock()

        mock_path_class.side_effect = path_side_effect

        # Mock Playwright
        mock_browser = MagicMock()
        mock_page = MagicMock()
        mock_browser.new_page.return_value = mock_page

        mock_playwright_instance = MagicMock()
        mock_playwright_instance.chromium.launch.return_value = mock_browser
        mock_playwright.return_value.__enter__.return_value = mock_playwright_instance

        service = PDFService()
        service.render_pdf("<html></html>", {})

        # Verify page.evaluate was called twice (cleanup and card splitting)
        assert mock_page.evaluate.call_count == 2

        # Verify cleanup script removes header/footer elements
        first_call_script = mock_page.evaluate.call_args_list[0][0][0]
        assert "print-header" in first_call_script
        assert "print-footer" in first_call_script
        assert "remove()" in first_call_script

    @patch('backend.services.pdf_service.sync_playwright')
    @patch('backend.services.pdf_service.tempfile.TemporaryDirectory')
    @patch('backend.services.pdf_service.Path')
    def test_render_pdf_sets_viewport(self, mock_path_class, mock_temp_dir, mock_playwright):
        """Test that render_pdf sets proper viewport size."""
        mock_temp_dir.return_value.__enter__.return_value = "/tmp/test"

        mock_html_path = MagicMock()
        mock_pdf_path = MagicMock()
        mock_pdf_path.read_bytes.return_value = b"PDF content"

        def path_side_effect(path):
            if "report.html" in str(path):
                return mock_html_path
            elif "report.pdf" in str(path):
                return mock_pdf_path
            return MagicMock()

        mock_path_class.side_effect = path_side_effect

        # Mock Playwright
        mock_browser = MagicMock()
        mock_page = MagicMock()
        mock_browser.new_page.return_value = mock_page

        mock_playwright_instance = MagicMock()
        mock_playwright_instance.chromium.launch.return_value = mock_browser
        mock_playwright.return_value.__enter__.return_value = mock_playwright_instance

        service = PDFService()
        service.render_pdf("<html></html>", {})

        # Verify viewport was set
        mock_page.set_viewport_size.assert_called_once_with({"width": 720, "height": 900})

    @patch('backend.services.pdf_service.sync_playwright')
    @patch('backend.services.pdf_service.tempfile.TemporaryDirectory')
    @patch('backend.services.pdf_service.Path')
    def test_render_pdf_applies_clean_print_css(self, mock_path_class, mock_temp_dir, mock_playwright):
        """Test that render_pdf applies the CLEAN_PRINT_CSS."""
        mock_temp_dir.return_value.__enter__.return_value = "/tmp/test"

        mock_html_path = MagicMock()
        mock_pdf_path = MagicMock()
        mock_pdf_path.read_bytes.return_value = b"PDF content"

        def path_side_effect(path):
            if "report.html" in str(path):
                return mock_html_path
            elif "report.pdf" in str(path):
                return mock_pdf_path
            return MagicMock()

        mock_path_class.side_effect = path_side_effect

        # Mock Playwright
        mock_browser = MagicMock()
        mock_page = MagicMock()
        mock_browser.new_page.return_value = mock_page

        mock_playwright_instance = MagicMock()
        mock_playwright_instance.chromium.launch.return_value = mock_browser
        mock_playwright.return_value.__enter__.return_value = mock_playwright_instance

        service = PDFService()
        service.render_pdf("<html></html>", {})

        # Verify CSS was added
        mock_page.add_style_tag.assert_called_once()
        css_content = mock_page.add_style_tag.call_args[1]["content"]
        assert "print-header" in css_content
        assert "print-footer" in css_content
        assert "@media print" in css_content
