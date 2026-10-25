# 刷题

个人使用的 iPad 网页刷题应用，题目、音频与学习记录保存在浏览器侧。

## 本地运行

```bash
npm ci
npm run dev
```

生产构建与预览：`npm run build`、`npm run preview`。电脑本地网页可直接调试；iPad 在同一局域网通过电脑地址访问普通 HTTP 页面时可以在线刷题，但离线缓存需要 iPad 信任的 HTTPS 地址。电脑的 `localhost` 只代表电脑自身，不能作为 iPad 的访问地址。

## 使用

打开站点后选择题库，点击“开始练习”或输入题号跳转。回答后可查看判题结果与解析；学习记录自动保存到当前浏览器。要离线使用，在联网时返回题库管理页，点击“准备离线资源”，等待题目和音频都显示准备完成。准备失败时再次点击可补齐缺失资源。iPad 可用 Safari 的“添加到主屏幕”创建入口。

学习记录只在当前站点来源与浏览器中；清除网站数据或更换域名会影响记录。题库音频约 200 MB，首次完整离线准备需要足够的网络流量和设备空间。

## 发布

在仓库 Settings → Pages 将 Source 设为 GitHub Actions 后，推送到 `main` 会运行 `Publish GitHub Pages` 工作流；也可在 Actions 手动运行。访问地址为 `https://wxy656.github.io/shuati-code/`。
