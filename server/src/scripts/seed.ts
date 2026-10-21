import bcrypt from 'bcryptjs';
import mongoose, { Types } from 'mongoose';
import { connectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { Plan, PLAN_LEVELS } from '../models/plan.model.js';
import { Problem } from '../models/problem.model.js';
import { User } from '../models/user.model.js';
import { JUDGE_CONTENT, TOPIC_GROUPS } from './seedData.js';

const DEV_USER = { name: 'Dev User', email: 'dev@commitdsa.test', password: 'password123' };

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const seed = async (): Promise<void> => {
  if (env.NODE_ENV === 'production') {
    console.error('[Seed] Refusing to run in production.');
    process.exit(1);
  }

  await connectDB();

  const allProblemIds: Types.ObjectId[] = [];
  const idsByTopic = new Map<string, Types.ObjectId[]>();
  const idsByLevel = new Map<string, Types.ObjectId[]>();
  let order = 0;

  for (const group of TOPIC_GROUPS) {
    const topicIds: Types.ObjectId[] = [];
    for (const [title, slug, difficulty] of group.problems) {
      order += 1;
      const judge = JUDGE_CONTENT[slug];
      const problem = await Problem.findOneAndUpdate(
        { slug },
        {
          $set: {
            title,
            slug,
            difficulty,
            topic: group.topic,
            url: `https://leetcode.com/problems/${slug}/`,
            source: 'LeetCode',
            order,
            active: true,
            judgeEnabled: Boolean(judge),
            ...(judge && {
              statement: judge.statement,
              constraints: judge.constraints,
              examples: judge.examples,
              starterCode: judge.starterCode,
              testCases: judge.testCases,
            }),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      allProblemIds.push(problem._id);
      topicIds.push(problem._id);
      idsByLevel.set(group.level, [...(idsByLevel.get(group.level) ?? []), problem._id]);
    }
    idsByTopic.set(group.topic, topicIds);
  }

  const topicsByLevel = (level: string): string[] =>
    TOPIC_GROUPS.filter((g) => g.level === level).map((g) => g.topic);

  const plans = [
    {
      name: 'DSA 150',
      slug: 'dsa-150',
      description:
        'The complete 150-problem track across every core topic, from Arrays & Hashing to Greedy.',
      topic: null,
      level: null,
      problemIds: allProblemIds,
    },
    // One combined card per tier, spanning every topic at that level — sits alongside the
    // single 150-problem track and the per-topic chapters below.
    ...PLAN_LEVELS.map((level) => ({
      name: `${level} Track`,
      slug: slugify(`${level} Track`),
      description: `Every ${level.toLowerCase()}-tier topic in one track: ${topicsByLevel(level).join(', ')}.`,
      topic: null,
      level,
      problemIds: idsByLevel.get(level) ?? [],
    })),
    ...TOPIC_GROUPS.map((group) => ({
      name: group.topic,
      slug: slugify(group.topic),
      description: `Focused practice on ${group.topic}, ordered from easier to harder.`,
      topic: group.topic,
      level: group.level,
      problemIds: idsByTopic.get(group.topic) ?? [],
    })),
  ];

  for (const [index, plan] of plans.entries()) {
    await Plan.findOneAndUpdate(
      { slug: plan.slug },
      { $set: { ...plan, order: index, active: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  // Retire any plan slugs (e.g. the old "dsa-fundamentals") that this seed no longer produces,
  // rather than leaving stale rows silently active.
  const currentSlugs = plans.map((plan) => plan.slug);
  await Plan.updateMany({ slug: { $nin: currentSlugs } }, { $set: { active: false } });

  const existingUser = await User.exists({ email: DEV_USER.email });
  if (!existingUser) {
    await User.create({
      name: DEV_USER.name,
      email: DEV_USER.email,
      passwordHash: await bcrypt.hash(DEV_USER.password, 12),
      timezone: 'Asia/Kolkata',
      role: 'USER',
    });
  }

  console.log(`[Seed] ${allProblemIds.length} problems, ${plans.length} plans.`);
  console.log(`[Seed] Dev login: ${DEV_USER.email} / ${DEV_USER.password}`);
  await mongoose.disconnect();
};

seed().catch((error) => {
  console.error('[Seed] Failed:', error);
  process.exit(1);
});
