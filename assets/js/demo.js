/**
 * demo.js — 内置示例作文（一键填入用）
 * 四级篇含刻意错误：双重比较级、中式表达、be 动词误用、连接词单调、词汇重复；
 * 六级篇含更隐晦问题：连接词密集、句式重复。
 * 词数由 tests/exporter.test.cjs 校验（四级 120-180；六级 150-200，设计文档 §8）。
 */
(function (root) {
  'use strict';

  var SAMPLES = {
    cet4: {
      level: '四级',
      title: 'On the Importance of Physical Exercise',
      text: [
        'Nowadays, more and more people pay attention to physical exercise. Some people think that exercise is very important for our health. But other people do not think so. In my opinion, I think exercise is very important to everyone.',
        'First of all, exercise can make our body become more stronger. If we often do exercise, we will not easy to get ill. The society is become more and more stressful, so we need a healthy body to face the challenges. Secondly, exercise can also make us happy. When we are running or playing basketball, we can forget our worries and relax ourselves.',
        'However, some students always stay in the dormitory and play computer games. They think exercise is a waste of time. I think this idea is wrong.',
        'In conclusion, exercise is very important. We should do exercise every day to keep healthy.',
      ].join('\n\n'),
    },
    cet6: {
      level: '六级',
      title: 'Will AI Replace Human Teachers?',
      text: [
        'With the rapid development of artificial intelligence, there is a heated debate about whether AI will replace human teachers in education. While some people welcome this change, others hold the opposite view. From my perspective, AI can never fully replace human teachers.',
        'Admittedly, artificial intelligence has brought many conveniences to education. For example, students can use AI tools to correct their grammar mistakes and get instant feedback, which greatly improves learning efficiency. Besides, AI is able to provide personalized learning plans according to students\' different levels.',
        'However, education is not only about knowledge transmission but also about emotional communication. A good teacher can inspire students\' curiosity and help them build up confidence, which no machine can achieve. When students face difficulties in their study, it is the teacher\'s encouragement that gives them power to move forward.',
        'Therefore, what we should do is to make good use of AI as a useful assistant of teachers, rather than letting it take the place of them. Only in this way can education develop better and better.',
      ].join('\n\n'),
    },
  };

  var api = { SAMPLES: SAMPLES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.EEC = root.EEC || {}).demo = api;
})(typeof self !== 'undefined' ? self : globalThis);
