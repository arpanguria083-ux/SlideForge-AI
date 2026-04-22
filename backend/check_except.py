import glob

files = glob.glob('app/**/*.py', recursive=True)
for file in files:
    with open(file, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    for i, line in enumerate(lines):
        if 'except Exception:' in line:
            print(f"--- {file}:{i+1} ---")
            for j in range(max(0, i-4), min(len(lines), i+2)):
                print(f"{j+1}: {lines[j].rstrip()}")
