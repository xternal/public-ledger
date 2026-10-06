import pytest


def pytest_addoption(parser):
    parser.addoption("--offline", action="store_true", help="skip tests that need to download source files")


@pytest.fixture
def offline(request):
    return request.config.getoption("--offline")
