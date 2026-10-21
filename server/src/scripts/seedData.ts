import type { Difficulty } from '../models/problem.model.js';
import type { PlanLevel } from '../models/plan.model.js';

type ProblemRow = [title: string, slug: string, difficulty: Difficulty];

export interface TopicGroup {
  topic: string;
  level: PlanLevel;
  problems: ProblemRow[];
}

export interface JudgeContent {
  statement: string;
  constraints: string[];
  examples: { input: string; output: string; explanation?: string }[];
  starterCode: { language: string; code: string }[];
  testCases: { input: string; expectedOutput: string; isSample: boolean }[];
}

// Original content we've written ourselves for the in-editor judge — never copied from LeetCode.
// Keyed by slug, applied on top of the matching entry below during seeding. Deliberately a small
// pilot (three Basic problems, all with a single deterministic answer so plain stdout diffing is
// enough to judge them) rather than all 150 — see PR notes for the plan to grow this set.
export const JUDGE_CONTENT: Record<string, JudgeContent> = {
  'contains-duplicate': {
    statement:
      "You'll be given a list of integers. Determine whether any value appears more than once " +
      'in the list.\n\n' +
      'Read an integer n on the first line, the number of values that follow. Read n ' +
      'space-separated integers on the second line. Print `true` if any value occurs at least ' +
      'twice, or `false` if every value is distinct.',
    constraints: ['1 <= n <= 100000', '-1000000000 <= value <= 1000000000'],
    examples: [
      { input: '5\n1 2 3 1 5', output: 'true', explanation: '1 appears twice.' },
      { input: '4\n7 8 9 10', output: 'false', explanation: 'Every value is distinct.' },
    ],
    starterCode: [
      {
        language: 'javascript',
        code:
          "const lines = require('fs').readFileSync('/dev/stdin', 'utf8').split('\\n');\n" +
          'const n = parseInt(lines[0], 10);\n' +
          "const nums = lines[1].trim().split(' ').map(Number);\n\n" +
          '// TODO: write your solution\n' +
          'const result = false;\n' +
          'console.log(result);\n',
      },
      {
        language: 'python',
        code:
          'import sys\n\n' +
          'data = sys.stdin.read().split("\\n")\n' +
          'n = int(data[0])\n' +
          'nums = list(map(int, data[1].split()))\n\n' +
          '# TODO: write your solution\n' +
          'result = False\n' +
          'print(str(result).lower())\n',
      },
      {
        language: 'java',
        code:
          'import java.util.*;\n\n' +
          'public class Solution {\n' +
          '    public static void main(String[] args) {\n' +
          '        Scanner scanner = new Scanner(System.in);\n' +
          '        int n = Integer.parseInt(scanner.nextLine().trim());\n' +
          '        StringTokenizer st = new StringTokenizer(scanner.nextLine());\n' +
          '        int[] nums = new int[n];\n' +
          '        for (int i = 0; i < n; i++) nums[i] = Integer.parseInt(st.nextToken());\n\n' +
          '        // TODO: write your solution\n' +
          '        boolean result = false;\n' +
          '        System.out.println(result);\n' +
          '    }\n' +
          '}\n',
      },
      {
        language: 'cpp',
        code:
          '#include <bits/stdc++.h>\n' +
          'using namespace std;\n\n' +
          'int main() {\n' +
          '    int n;\n' +
          '    cin >> n;\n' +
          '    vector<long long> nums(n);\n' +
          '    for (int i = 0; i < n; i++) cin >> nums[i];\n\n' +
          '    // TODO: write your solution\n' +
          '    bool result = false;\n' +
          '    cout << (result ? "true" : "false") << endl;\n' +
          '    return 0;\n' +
          '}\n',
      },
    ],
    testCases: [
      { input: '5\n1 2 3 1 5', expectedOutput: 'true', isSample: true },
      { input: '4\n7 8 9 10', expectedOutput: 'false', isSample: true },
      { input: '1\n42', expectedOutput: 'false', isSample: false },
      { input: '6\n-1 -2 -3 -1 -2 -3', expectedOutput: 'true', isSample: false },
      { input: '3\n0 0 0', expectedOutput: 'true', isSample: false },
    ],
  },
  'valid-anagram': {
    statement:
      'You are given two strings. Decide whether the second string is an anagram of the first ' +
      '— that is, whether it uses exactly the same letters, the same number of times, just ' +
      'possibly rearranged.\n\n' +
      'Read the first string on line 1 and the second string on line 2 (both lowercase letters ' +
      'only, no spaces). Print `true` if the second string is an anagram of the first, otherwise ' +
      'print `false`.',
    constraints: [
      '1 <= length of each string <= 100000',
      'Both strings contain only lowercase English letters.',
    ],
    examples: [
      { input: 'anagram\nnagaram', output: 'true' },
      { input: 'rat\ncar', output: 'false' },
    ],
    starterCode: [
      {
        language: 'javascript',
        code:
          "const lines = require('fs').readFileSync('/dev/stdin', 'utf8').split('\\n');\n" +
          'const s = lines[0].trim();\n' +
          'const t = lines[1].trim();\n\n' +
          '// TODO: write your solution\n' +
          'const result = false;\n' +
          'console.log(result);\n',
      },
      {
        language: 'python',
        code:
          'import sys\n\n' +
          'data = sys.stdin.read().split("\\n")\n' +
          's = data[0].strip()\n' +
          't = data[1].strip()\n\n' +
          '# TODO: write your solution\n' +
          'result = False\n' +
          'print(str(result).lower())\n',
      },
      {
        language: 'java',
        code:
          'import java.util.*;\n\n' +
          'public class Solution {\n' +
          '    public static void main(String[] args) {\n' +
          '        Scanner scanner = new Scanner(System.in);\n' +
          '        String s = scanner.nextLine().trim();\n' +
          '        String t = scanner.nextLine().trim();\n\n' +
          '        // TODO: write your solution\n' +
          '        boolean result = false;\n' +
          '        System.out.println(result);\n' +
          '    }\n' +
          '}\n',
      },
      {
        language: 'cpp',
        code:
          '#include <bits/stdc++.h>\n' +
          'using namespace std;\n\n' +
          'int main() {\n' +
          '    string s, t;\n' +
          '    cin >> s >> t;\n\n' +
          '    // TODO: write your solution\n' +
          '    bool result = false;\n' +
          '    cout << (result ? "true" : "false") << endl;\n' +
          '    return 0;\n' +
          '}\n',
      },
    ],
    testCases: [
      { input: 'anagram\nnagaram', expectedOutput: 'true', isSample: true },
      { input: 'rat\ncar', expectedOutput: 'false', isSample: true },
      { input: 'a\na', expectedOutput: 'true', isSample: false },
      { input: 'ab\nba', expectedOutput: 'true', isSample: false },
      { input: 'abc\nabd', expectedOutput: 'false', isSample: false },
      { input: 'aabbcc\naabbc', expectedOutput: 'false', isSample: false },
    ],
  },
  'majority-element': {
    statement:
      'You are given a list of integers that is guaranteed to contain a majority element — a ' +
      'value that appears in more than half of the positions. Find and print that value.\n\n' +
      'Read an integer n on the first line, then n space-separated integers on the second line. ' +
      'Print the majority element.',
    constraints: [
      '1 <= n <= 100000',
      "It's guaranteed that a majority element exists.",
      '-1000000000 <= value <= 1000000000',
    ],
    examples: [
      { input: '3\n3 2 3', output: '3' },
      { input: '7\n2 2 1 1 1 2 2', output: '2' },
    ],
    starterCode: [
      {
        language: 'javascript',
        code:
          "const lines = require('fs').readFileSync('/dev/stdin', 'utf8').split('\\n');\n" +
          'const n = parseInt(lines[0], 10);\n' +
          "const nums = lines[1].trim().split(' ').map(Number);\n\n" +
          '// TODO: write your solution\n' +
          'const result = nums[0];\n' +
          'console.log(result);\n',
      },
      {
        language: 'python',
        code:
          'import sys\n\n' +
          'data = sys.stdin.read().split("\\n")\n' +
          'n = int(data[0])\n' +
          'nums = list(map(int, data[1].split()))\n\n' +
          '# TODO: write your solution\n' +
          'result = nums[0]\n' +
          'print(result)\n',
      },
      {
        language: 'java',
        code:
          'import java.util.*;\n\n' +
          'public class Solution {\n' +
          '    public static void main(String[] args) {\n' +
          '        Scanner scanner = new Scanner(System.in);\n' +
          '        int n = Integer.parseInt(scanner.nextLine().trim());\n' +
          '        StringTokenizer st = new StringTokenizer(scanner.nextLine());\n' +
          '        int[] nums = new int[n];\n' +
          '        for (int i = 0; i < n; i++) nums[i] = Integer.parseInt(st.nextToken());\n\n' +
          '        // TODO: write your solution\n' +
          '        int result = nums[0];\n' +
          '        System.out.println(result);\n' +
          '    }\n' +
          '}\n',
      },
      {
        language: 'cpp',
        code:
          '#include <bits/stdc++.h>\n' +
          'using namespace std;\n\n' +
          'int main() {\n' +
          '    int n;\n' +
          '    cin >> n;\n' +
          '    vector<long long> nums(n);\n' +
          '    for (int i = 0; i < n; i++) cin >> nums[i];\n\n' +
          '    // TODO: write your solution\n' +
          '    long long result = nums[0];\n' +
          '    cout << result << endl;\n' +
          '    return 0;\n' +
          '}\n',
      },
    ],
    testCases: [
      { input: '3\n3 2 3', expectedOutput: '3', isSample: true },
      { input: '7\n2 2 1 1 1 2 2', expectedOutput: '2', isSample: true },
      { input: '1\n9', expectedOutput: '9', isSample: false },
      { input: '5\n1 1 1 2 2', expectedOutput: '1', isSample: false },
      { input: '9\n-5 -5 -5 -5 3 3 3 3 -5', expectedOutput: '-5', isSample: false },
    ],
  },
};

// Metadata only. Each problem links out to its LeetCode page via its slug.
// Grouped into a Basic / Medium / Advanced progression so the challenges page
// can present the full ~150-problem list as tiered tracks.
export const TOPIC_GROUPS: TopicGroup[] = [
  {
    topic: 'Arrays & Hashing',
    level: 'Basic',
    problems: [
      ['Contains Duplicate', 'contains-duplicate', 'Easy'],
      ['Valid Anagram', 'valid-anagram', 'Easy'],
      ['Two Sum', 'two-sum', 'Easy'],
      ['Majority Element', 'majority-element', 'Easy'],
      ['Group Anagrams', 'group-anagrams', 'Medium'],
      ['Top K Frequent Elements', 'top-k-frequent-elements', 'Medium'],
      ['Product of Array Except Self', 'product-of-array-except-self', 'Medium'],
      ['Valid Sudoku', 'valid-sudoku', 'Medium'],
      ['Longest Consecutive Sequence', 'longest-consecutive-sequence', 'Medium'],
      ['Subarray Sum Equals K', 'subarray-sum-equals-k', 'Medium'],
    ],
  },
  {
    topic: 'Two Pointers',
    level: 'Basic',
    problems: [
      ['Valid Palindrome', 'valid-palindrome', 'Easy'],
      ['Move Zeroes', 'move-zeroes', 'Easy'],
      ['Reverse String', 'reverse-string', 'Easy'],
      ['Remove Duplicates from Sorted Array', 'remove-duplicates-from-sorted-array', 'Easy'],
      ['Two Sum II - Input Array Is Sorted', 'two-sum-ii-input-array-is-sorted', 'Medium'],
      ['3Sum', '3sum', 'Medium'],
      ['Container With Most Water', 'container-with-most-water', 'Medium'],
      ['Sort Colors', 'sort-colors', 'Medium'],
      ['3Sum Closest', '3sum-closest', 'Medium'],
      ['Trapping Rain Water', 'trapping-rain-water', 'Hard'],
    ],
  },
  {
    topic: 'Sliding Window',
    level: 'Basic',
    problems: [
      ['Best Time to Buy and Sell Stock', 'best-time-to-buy-and-sell-stock', 'Easy'],
      ['Maximum Average Subarray I', 'maximum-average-subarray-i', 'Easy'],
      [
        'Longest Substring Without Repeating Characters',
        'longest-substring-without-repeating-characters',
        'Medium',
      ],
      [
        'Longest Repeating Character Replacement',
        'longest-repeating-character-replacement',
        'Medium',
      ],
      ['Permutation in String', 'permutation-in-string', 'Medium'],
      ['Minimum Size Subarray Sum', 'minimum-size-subarray-sum', 'Medium'],
      ['Find All Anagrams in a String', 'find-all-anagrams-in-a-string', 'Medium'],
      ['Fruit Into Baskets', 'fruit-into-baskets', 'Medium'],
      ['Minimum Window Substring', 'minimum-window-substring', 'Hard'],
      ['Sliding Window Maximum', 'sliding-window-maximum', 'Hard'],
    ],
  },
  {
    topic: 'Stack',
    level: 'Basic',
    problems: [
      ['Valid Parentheses', 'valid-parentheses', 'Easy'],
      ['Next Greater Element I', 'next-greater-element-i', 'Easy'],
      ['Baseball Game', 'baseball-game', 'Easy'],
      [
        'Remove All Adjacent Duplicates In String',
        'remove-all-adjacent-duplicates-in-string',
        'Easy',
      ],
      ['Min Stack', 'min-stack', 'Medium'],
      ['Evaluate Reverse Polish Notation', 'evaluate-reverse-polish-notation', 'Medium'],
      ['Daily Temperatures', 'daily-temperatures', 'Medium'],
      ['Car Fleet', 'car-fleet', 'Medium'],
      ['Decode String', 'decode-string', 'Medium'],
      ['Largest Rectangle in Histogram', 'largest-rectangle-in-histogram', 'Hard'],
    ],
  },
  {
    topic: 'Binary Search',
    level: 'Basic',
    problems: [
      ['Binary Search', 'binary-search', 'Easy'],
      ['First Bad Version', 'first-bad-version', 'Easy'],
      ['Search Insert Position', 'search-insert-position', 'Easy'],
      ['Search a 2D Matrix', 'search-a-2d-matrix', 'Medium'],
      ['Koko Eating Bananas', 'koko-eating-bananas', 'Medium'],
      ['Find Minimum in Rotated Sorted Array', 'find-minimum-in-rotated-sorted-array', 'Medium'],
      ['Search in Rotated Sorted Array', 'search-in-rotated-sorted-array', 'Medium'],
      ['Time Based Key-Value Store', 'time-based-key-value-store', 'Medium'],
      [
        'Find First and Last Position of Element in Sorted Array',
        'find-first-and-last-position-of-element-in-sorted-array',
        'Medium',
      ],
      ['Median of Two Sorted Arrays', 'median-of-two-sorted-arrays', 'Hard'],
    ],
  },
  {
    topic: 'Linked List',
    level: 'Medium',
    problems: [
      ['Reverse Linked List', 'reverse-linked-list', 'Easy'],
      ['Merge Two Sorted Lists', 'merge-two-sorted-lists', 'Easy'],
      ['Linked List Cycle', 'linked-list-cycle', 'Easy'],
      ['Middle of the Linked List', 'middle-of-the-linked-list', 'Easy'],
      ['Reorder List', 'reorder-list', 'Medium'],
      ['Remove Nth Node From End of List', 'remove-nth-node-from-end-of-list', 'Medium'],
      ['Add Two Numbers', 'add-two-numbers', 'Medium'],
      ['Copy List with Random Pointer', 'copy-list-with-random-pointer', 'Medium'],
      ['Find the Duplicate Number', 'find-the-duplicate-number', 'Medium'],
      ['LRU Cache', 'lru-cache', 'Medium'],
      ['Merge k Sorted Lists', 'merge-k-sorted-lists', 'Hard'],
    ],
  },
  {
    topic: 'Trees',
    level: 'Medium',
    problems: [
      ['Invert Binary Tree', 'invert-binary-tree', 'Easy'],
      ['Maximum Depth of Binary Tree', 'maximum-depth-of-binary-tree', 'Easy'],
      ['Diameter of Binary Tree', 'diameter-of-binary-tree', 'Easy'],
      ['Balanced Binary Tree', 'balanced-binary-tree', 'Easy'],
      ['Same Tree', 'same-tree', 'Easy'],
      ['Subtree of Another Tree', 'subtree-of-another-tree', 'Easy'],
      [
        'Lowest Common Ancestor of a Binary Search Tree',
        'lowest-common-ancestor-of-a-binary-search-tree',
        'Medium',
      ],
      ['Binary Tree Level Order Traversal', 'binary-tree-level-order-traversal', 'Medium'],
      ['Binary Tree Right Side View', 'binary-tree-right-side-view', 'Medium'],
      ['Count Good Nodes in Binary Tree', 'count-good-nodes-in-binary-tree', 'Medium'],
      ['Validate Binary Search Tree', 'validate-binary-search-tree', 'Medium'],
      ['Kth Smallest Element in a BST', 'kth-smallest-element-in-a-bst', 'Medium'],
      [
        'Construct Binary Tree from Preorder and Inorder Traversal',
        'construct-binary-tree-from-preorder-and-inorder-traversal',
        'Medium',
      ],
      ['Binary Tree Maximum Path Sum', 'binary-tree-maximum-path-sum', 'Hard'],
    ],
  },
  {
    topic: 'Heap / Priority Queue',
    level: 'Medium',
    problems: [
      ['Kth Largest Element in a Stream', 'kth-largest-element-in-a-stream', 'Easy'],
      ['Last Stone Weight', 'last-stone-weight', 'Easy'],
      ['K Closest Points to Origin', 'k-closest-points-to-origin', 'Medium'],
      ['Kth Largest Element in an Array', 'kth-largest-element-in-an-array', 'Medium'],
      ['Task Scheduler', 'task-scheduler', 'Medium'],
      ['Top K Frequent Words', 'top-k-frequent-words', 'Medium'],
      ['Reorganize String', 'reorganize-string', 'Medium'],
      ['Find Median from Data Stream', 'find-median-from-data-stream', 'Hard'],
    ],
  },
  {
    topic: 'Backtracking',
    level: 'Medium',
    problems: [
      ['Subsets', 'subsets', 'Medium'],
      ['Combination Sum', 'combination-sum', 'Medium'],
      ['Permutations', 'permutations', 'Medium'],
      ['Subsets II', 'subsets-ii', 'Medium'],
      ['Generate Parentheses', 'generate-parentheses', 'Medium'],
      ['Word Search', 'word-search', 'Medium'],
      ['Palindrome Partitioning', 'palindrome-partitioning', 'Medium'],
      ['Letter Combinations of a Phone Number', 'letter-combinations-of-a-phone-number', 'Medium'],
      ['N-Queens', 'n-queens', 'Hard'],
    ],
  },
  {
    topic: 'Graphs',
    level: 'Advanced',
    problems: [
      ['Number of Islands', 'number-of-islands', 'Medium'],
      ['Max Area of Island', 'max-area-of-island', 'Medium'],
      ['Clone Graph', 'clone-graph', 'Medium'],
      ['Pacific Atlantic Water Flow', 'pacific-atlantic-water-flow', 'Medium'],
      ['Rotting Oranges', 'rotting-oranges', 'Medium'],
      ['Course Schedule', 'course-schedule', 'Medium'],
      ['Course Schedule II', 'course-schedule-ii', 'Medium'],
      ['Redundant Connection', 'redundant-connection', 'Medium'],
      ['Surrounded Regions', 'surrounded-regions', 'Medium'],
      ['Network Delay Time', 'network-delay-time', 'Medium'],
      ['Cheapest Flights Within K Stops', 'cheapest-flights-within-k-stops', 'Medium'],
      ['Word Ladder', 'word-ladder', 'Hard'],
    ],
  },
  {
    topic: 'Dynamic Programming',
    level: 'Advanced',
    problems: [
      ['Climbing Stairs', 'climbing-stairs', 'Easy'],
      ['Min Cost Climbing Stairs', 'min-cost-climbing-stairs', 'Easy'],
      ['House Robber', 'house-robber', 'Medium'],
      ['House Robber II', 'house-robber-ii', 'Medium'],
      ['Longest Palindromic Substring', 'longest-palindromic-substring', 'Medium'],
      ['Palindromic Substrings', 'palindromic-substrings', 'Medium'],
      ['Decode Ways', 'decode-ways', 'Medium'],
      ['Coin Change', 'coin-change', 'Medium'],
      ['Maximum Product Subarray', 'maximum-product-subarray', 'Medium'],
      ['Word Break', 'word-break', 'Medium'],
      ['Longest Increasing Subsequence', 'longest-increasing-subsequence', 'Medium'],
      ['Partition Equal Subset Sum', 'partition-equal-subset-sum', 'Medium'],
      ['Unique Paths', 'unique-paths', 'Medium'],
      ['Longest Common Subsequence', 'longest-common-subsequence', 'Medium'],
      [
        'Best Time to Buy and Sell Stock with Cooldown',
        'best-time-to-buy-and-sell-stock-with-cooldown',
        'Medium',
      ],
      ['Edit Distance', 'edit-distance', 'Medium'],
    ],
  },
  {
    topic: 'Bit Manipulation',
    level: 'Basic',
    problems: [
      ['Single Number', 'single-number', 'Easy'],
      ['Number of 1 Bits', 'number-of-1-bits', 'Easy'],
      ['Counting Bits', 'counting-bits', 'Easy'],
      ['Reverse Bits', 'reverse-bits', 'Easy'],
      ['Missing Number', 'missing-number', 'Easy'],
      ['Sum of Two Integers', 'sum-of-two-integers', 'Medium'],
      ['Reverse Integer', 'reverse-integer', 'Medium'],
    ],
  },
  {
    topic: 'Intervals',
    level: 'Medium',
    problems: [
      ['Insert Interval', 'insert-interval', 'Medium'],
      ['Merge Intervals', 'merge-intervals', 'Medium'],
      ['Non-overlapping Intervals', 'non-overlapping-intervals', 'Medium'],
      ['My Calendar I', 'my-calendar-i', 'Medium'],
      ['Interval List Intersections', 'interval-list-intersections', 'Medium'],
      [
        'Minimum Interval to Include Each Query',
        'minimum-interval-to-include-each-query',
        'Hard',
      ],
    ],
  },
  {
    topic: 'Math & Geometry',
    level: 'Medium',
    problems: [
      ['Happy Number', 'happy-number', 'Easy'],
      ['Plus One', 'plus-one', 'Easy'],
      ['Rotate Image', 'rotate-image', 'Medium'],
      ['Spiral Matrix', 'spiral-matrix', 'Medium'],
      ['Set Matrix Zeroes', 'set-matrix-zeroes', 'Medium'],
      ['Pow(x, n)', 'powx-n', 'Medium'],
      ['Multiply Strings', 'multiply-strings', 'Medium'],
    ],
  },
  {
    topic: 'Tries',
    level: 'Advanced',
    problems: [
      ['Implement Trie (Prefix Tree)', 'implement-trie-prefix-tree', 'Medium'],
      ['Longest Word in Dictionary', 'longest-word-in-dictionary', 'Medium'],
      [
        'Design Add and Search Words Data Structure',
        'design-add-and-search-words-data-structure',
        'Medium',
      ],
      ['Word Search II', 'word-search-ii', 'Hard'],
    ],
  },
  {
    topic: 'Greedy',
    level: 'Advanced',
    problems: [
      ['Maximum Subarray', 'maximum-subarray', 'Medium'],
      ['Jump Game', 'jump-game', 'Medium'],
      ['Jump Game II', 'jump-game-ii', 'Medium'],
      ['Gas Station', 'gas-station', 'Medium'],
      ['Hand of Straights', 'hand-of-straights', 'Medium'],
      [
        'Merge Triplets to Form Target Triplet',
        'merge-triplets-to-form-target-triplet',
        'Medium',
      ],
    ],
  },
];
