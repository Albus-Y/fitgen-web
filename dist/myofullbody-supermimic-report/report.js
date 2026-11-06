'use strict';

// 本地 HTML 读取仓库 local-media 中的完整视频；HTTP 访问使用现有分片。
// 浏览器禁止 file: 页面通过 fetch 读取分片，因此不能走同一加载路径。
function attachTrainingVideo(video) {
  if (window.location.protocol === 'file:') {
    const filename = video.dataset.media.split('/').pop();
    video.src = new URL('../../local-media/myofullbody-supermimic-report/' + filename, document.baseURI).href;
    video.preload = 'metadata';
    video.load();
  } else {
    FitGenMedia.attach(video, video.dataset.media);
  }
}

// 进入视频区域时再载入，避免阅读能量计算部分时下载全部视频。
const trainingVideos = document.querySelectorAll('video[data-media]');
if ('IntersectionObserver' in window) {
  const videoObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      videoObserver.unobserve(entry.target);
      attachTrainingVideo(entry.target);
    });
  }, { rootMargin: '200px' });
  trainingVideos.forEach(video => videoObserver.observe(video));
} else {
  trainingVideos.forEach(attachTrainingVideo);
}
