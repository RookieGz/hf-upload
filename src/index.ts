import PQueue from './p-queue'
import Upload from './upload'
import {
  updateFileLists,
  deleteFile,
  deleteId,
  preproccessFile,
  fileToObject,
} from './util'
import defaultOptions from './default'
import { UploadStatus } from './enums'

interface Info {
  file?: HFUploader.UploadFile
  fileList?: Array<HFUploader.UploadFile>
}

interface Props {
  files?: Array<HFUploader.UploadFile>
  /** 配置项 */
  options?: HFUploader.Options
  /** 创建OSS参数 */
  params?: any
  /** 上传开始 */
  onStart?: Function
  /** beforeUpload */
  beforeUpload?: Function
  /** afterUpload */
  afterUpload?: Function
  /** needUpdateParams */
  needUpdateParams?: Function
  /** file change */
  onChange?: ({ file, fileList }: Info) => void
  /** file Succeed */
  onSucceed?: ({ file, fileList }: Info) => void
  /** file Failed */
  onFailed?: ({ file, fileList }: Info) => void
  /** complete */
  onComplete?: ({ fileList }: Info) => void
}

export default class HFUploader {
  map: Object = {}
  ids: Array<string> = []
  params: any
  queue: PQueue
  options: HFUploader.Options
  fileList: Array<HFUploader.UploadFile> = []
  needUpdateParams?: Function
  onStart?: Function
  afterUpload?: Function
  beforeUpload?: Function
  onChange: ({ file, fileList }: Info) => void
  onSucceed: ({ file, fileList }: Info) => void
  onFailed: ({ file, fileList }: Info) => void
  onComplete: ({ fileList }: Info) => void

  constructor({
    files,
    options = {},
    params,
    onStart,
    onChange,
    onSucceed,
    onFailed,
    onComplete,
    afterUpload,
    beforeUpload,
    needUpdateParams,
  }: Props) {
    this.map = {}
    this.fileList = files || []
    this.params = { ...params }
    this.queue = new PQueue({
      concurrency: options.concurrency || defaultOptions.concurrency,
    })

    this.options = { ...defaultOptions, ...options }
    this.onStart = onStart
    this.onChange = onChange
    this.onSucceed = onSucceed
    this.onFailed = onFailed
    this.onComplete = onComplete
    this.afterUpload = afterUpload
    this.beforeUpload = beforeUpload
    this.needUpdateParams = needUpdateParams
  }

  // 更新参数
  updateParams = (params) => {
    this.params = { ...params }

    for (let uid in this.map) {
      if (this.map[uid]) {
        this.map[uid].updateParams(params)
      }
    }
  }

  // 添加
  add = (files: Array<HFUploader.UploadFile>) => {
    if (this.onStart) {
      this.onStart()
    }

    this.start(files)
  }

  // 暂停
  abort = (uid: string) => {
    if (this.map[uid]) {
      this.map[uid].cancelUpload()
      this.queue._next()
    }
  }

  // 删除
  delete = (uid: string) => {
    this.abort(uid)
    this.queue.clearWithId(uid)
    this.fileList = deleteFile(uid, this.fileList)
    this.ids = deleteId(uid, this.ids)
    if (this.onChange) {
      this.onChange({ fileList: this.fileList })
    }
  }

  // 清空
  clear = () => {
    this.fileList = []
    this.queue.clear()
    for (const key in this.map) {
      if (this.map[key]) {
        this.map[key].cancelUpload()
      }
    }
  }

  // 重新上传
  reupload = (uid: string) => {
    const targetUploader = this.map[uid]
    if (targetUploader) {
      targetUploader.reUpload()
    }
  }

  // 开始上传
  start = (files: Array<HFUploader.UploadFile>) => {
    const addFile = (file) => {
      this.queue.add(
        () => {
          const parameter = {
            file,
            params: this.params,
            options: this.options,
            onChange: this.handleChange,
            onSucceed: this.handleSucceed,
            onFailed: this.handleFailed,
            afterUpload: this.afterUpload,
            needUpdateParams: this.needUpdateParams,
          }
          const upload = Upload(file.type, file.uploadConfig, parameter)
          this.map[file.uid] = upload
          return upload.startUpload()
        },
        { id: file.uid }
      )
    }

    // 计算md5
    const md5File = async (f) => {
      const Worker = await import('./file.worker.js')
      const myWorker = new Worker.default()
      myWorker.postMessage({ file: f.originFile })
      myWorker.onmessage = (e) => {
        f.md5_file = e.data
        addFile(f)
        myWorker.terminate()
      }
    }

    files.forEach((f) => {
      const objFile = fileToObject(f)
      objFile.status = UploadStatus.Waiting
      this.handleChange(objFile)
      // 计算 width height aspect transform thumbUrl
      preproccessFile(objFile).then(() => {
        const before = this.beforeUpload && this.beforeUpload(objFile)
        if (before && before.then) {
          before
            .then(() => {
              md5File(objFile)
            })
            .catch((e) => {
              objFile.status = UploadStatus.Error
              objFile.errorMessage = typeof e === 'string' ? e : 'error'
              this.handleFailed(objFile)
            })
        } else {
          md5File(objFile)
        }
      })
    })
  }

  handleChange = (file: HFUploader.UploadFile) => {
    const { fileList, onChange } = this
    this.fileList = updateFileLists(file, fileList)
    if (onChange) {
      onChange({ file, fileList })
    }
  }

  handleSucceed = (file: HFUploader.UploadFile) => {
    const { fileList, onSucceed, checkComplete } = this
    this.fileList = updateFileLists(file, fileList)
    checkComplete(file.uid)
    if (onSucceed) {
      onSucceed({ file, fileList })
    }
  }

  handleFailed = (file: HFUploader.UploadFile) => {
    const { fileList, onFailed, checkComplete } = this
    this.fileList = updateFileLists(file, fileList)
    checkComplete(file.uid)
    if (onFailed) {
      onFailed({ file, fileList })
    }
  }

  checkComplete = (uid: string) => {
    const { fileList, onComplete } = this
    this.ids.push(uid)
    const dedupeIds = Array.from(new Set(this.ids))
    if (dedupeIds.length === fileList.length && onComplete) {
      onComplete({ fileList })
    }
  }
}
