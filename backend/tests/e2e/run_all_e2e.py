import asyncio
import subprocess
import sys
import time
from pathlib import Path


def run_test(script_name: str) -> bool:
    print(f"\n{'=' * 60}")
    print(f"RUNNING: {script_name}")
    print(f"{'=' * 60}")

    script_path = Path(__file__).parent / script_name

    try:
        # Run using the same python executable
        result = subprocess.run(
            [sys.executable, str(script_path)],
            capture_output=False,
            text=True,
            check=False,
        )
        return result.returncode == 0
    except Exception as e:
        print(f"Failed to execute {script_name}: {e}")
        return False


async def main():
    start_time = time.time()
    print("SlideForge-AI End-to-End Test Suite")
    print(f"Started at: {time.ctime()}")

    tests = [
        "test_connectivity.py",
        "test_claims.py",
        "test_structure.py",
        "test_language.py",
        "test_revisions.py",
    ]

    results = []
    for test in tests:
        success = run_test(test)
        results.append((test, success))

    print(f"\n{'#' * 60}")
    print("FINAL TEST SUMMARY")
    print(f"{'#' * 60}")

    all_passed = True
    for test, success in results:
        status = "[ PASS ]" if success else "[ FAIL ]"
        print(f"{status} {test}")
        if not success:
            all_passed = False

    duration = time.time() - start_time
    print(f"\nTotal Duration: {duration:.2f}s")

    if all_passed:
        print("\nSUCCESS: All AI pipeline components are functional.")
        sys.exit(0)
    else:
        print("\nFAILURE: One or more components failed. Check logs above.")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
