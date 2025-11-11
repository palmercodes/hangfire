import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {

  private let statusLabel: UILabel = {
    let label = UILabel()
    label.translatesAutoresizingMaskIntoConstraints = false
    label.textAlignment = .center
    label.font = UIFont.preferredFont(forTextStyle: .body)
    label.textColor = .secondaryLabel
    label.numberOfLines = 0
    label.text = "Opening Hangfire…"
    return label
  }()

  private let spinner: UIActivityIndicatorView = {
    let view = UIActivityIndicatorView(style: .medium)
    view.translatesAutoresizingMaskIntoConstraints = false
    view.startAnimating()
    return view
  }()

  override func viewDidLoad() {
    super.viewDidLoad()

    view.backgroundColor = .systemBackground
    layout()

    DispatchQueue.main.async { [weak self] in
      self?.handleSharedContent()
    }
  }

  private func layout() {
    view.addSubview(spinner)
    view.addSubview(statusLabel)

    NSLayoutConstraint.activate([
      spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -16),

      statusLabel.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 12),
      statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
      statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24)
    ])
  }

  private func handleSharedContent() {
    guard let item = extensionContext?.inputItems.first as? NSExtensionItem else {
      closeExtension()
      return
    }

    let attachments = item.attachments ?? []

    if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
      loadItem(from: provider, typeIdentifier: UTType.url.identifier)
      return
    }

    if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.text.identifier) }) {
      loadItem(from: provider, typeIdentifier: UTType.text.identifier)
      return
    }

    closeExtension()
  }

  private func loadItem(from provider: NSItemProvider, typeIdentifier: String) {
    provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { [weak self] item, error in
      guard let self = self else { return }

      if let _ = error {
        self.closeExtension()
        return
      }

      var incomingURLString: String?

      if let url = item as? URL {
        incomingURLString = url.absoluteString
      } else if let data = item as? Data, let string = String(data: data, encoding: .utf8) {
        incomingURLString = string
      } else if let string = item as? String {
        incomingURLString = string
      }

      guard let rawString = incomingURLString, !rawString.isEmpty else {
        self.closeExtension()
        return
      }

      self.openHangfire(with: rawString)
    }
  }

  private func openHangfire(with sharedString: String) {
    let trimmed = sharedString.trimmingCharacters(in: .whitespacesAndNewlines)

    guard let encodedUrl = trimmed.addingPercentEncoding(withAllowedCharacters: CharacterSet.urlQueryAllowed),
          let targetUrl = URL(string: "hangfire://share?url=\(encodedUrl)") else {
      closeExtension()
      return
    }

    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      guard let context = self.extensionContext else { return }

      context.open(targetUrl) { success in
        if !success {
          var responder: UIResponder? = self
          while let currentResponder = responder {
            if let application = currentResponder as? UIApplication {
              application.open(targetUrl, options: [:], completionHandler: { _ in
                context.completeRequest(returningItems: nil, completionHandler: nil)
              })
              return
            }
            responder = currentResponder.next
          }
        }
        self.closeExtension()
      }
    }
  }

  private func closeExtension() {
    DispatchQueue.main.async { [weak self] in
      self?.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
  }
}

