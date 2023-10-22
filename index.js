const crypto = require("crypto");

const azureIdentity = require("@azure/identity");
const appConfig = require("@azure/app-configuration");
const keyVault = require("@azure/keyvault-secrets");
const storageBlob = require("@azure/storage-blob");
const azureCommunication = require("@azure/communication-email");

const OpenAI = require("openai");
const imageminPng = require("imagemin-pngquant");

(async function() {
	const azureCredential = new azureIdentity.DefaultAzureCredential();
	const configuration = await getConfiguration(azureCredential);
	
	const imagemin = (await import('imagemin')).default;
	const containerClient = getContainerClient(azureCredential);
	
	const images = await generateImages(configuration);
	for (const image of images) {
		await uploadToStorage(containerClient, image);
		await compressImage(imagemin, image);
		await emailImage(image, configuration, azureCredential);
	}
})();

async function getConfiguration(azureCredential) {
	const appConfigClient = new appConfig.AppConfigurationClient("https://app-configuration-7298.azconfig.io", azureCredential);
	
	const { value: openAIPrompt } = await appConfigClient.getConfigurationSetting({ key: "OpenAIPrompt" });
	const { value: openAISecretKey } = await getOpenAISecretKey(appConfigClient, azureCredential);
	const { value: senderEmailAddress } = await appConfigClient.getConfigurationSetting({ key: "SenderEmailAddress" });
	const { value: pictureFrameEmailAddress } = await appConfigClient.getConfigurationSetting({ key: "PictureFrameEmailAddress" });
	const { value: numberOfImagesToGenerate } = await appConfigClient.getConfigurationSetting({ key: "NumberOfImagesToGenerate" });

	return {
		openAIPrompt,
		openAISecretKey,
		senderEmailAddress,
		pictureFrameEmailAddress,
		numberOfImagesToGenerate: Number(numberOfImagesToGenerate)
	};
}

async function getOpenAISecretKey(appConfigClient, azureCredential) {
	const response = await appConfigClient.getConfigurationSetting({ key: "OpenAISecretKey" });
	const parsedSecretReference = appConfig.parseSecretReference(response);
	const { name: secretName, vaultUrl } = keyVault.parseKeyVaultSecretIdentifier(parsedSecretReference.value.secretId);

	const secretClient = new keyVault.SecretClient(vaultUrl, azureCredential);
	const openAISecretKey = await secretClient.getSecret(secretName);
	return openAISecretKey;
}

async function generateImages(configuration) {
	const openAIClient = new OpenAI({ apiKey: configuration.openAISecretKey });
	
	const response = await openAIClient.images.generate({
		prompt: configuration.openAIPrompt,
		n: configuration.numberOfImagesToGenerate,
		response_format: "b64_json",
		size: "1024x1024"
	});
	
	const images = response.data.map(x => {
		const id = crypto.randomUUID();
		return {
			id,
			name: `${id}.png`,
			base64: x.b64_json
		};
	});

	return images;
}

function getContainerClient(azureCredential) {
	const blobServiceClient = new storageBlob.BlobServiceClient("https://storageaccount23487.blob.core.windows.net", azureCredential);
	const containerClient = blobServiceClient.getContainerClient("ai-generated-images");
	return containerClient;
}

async function uploadToStorage(containerClient, image) {
	const blockBlobClient = containerClient.getBlockBlobClient(image.name);
	const buffer = Buffer.from(image.base64, "base64");
	await blockBlobClient.upload(buffer, buffer.length);
}

async function compressImage(imagemin, image) {
	const buffer = Buffer.from(image.base64, "base64");

	const compressedBuffer = await imagemin.buffer(buffer, {
		plugins: [
			imageminPng({ quality: [0, 1] })
		]
	});

	image.compressedBase64 = compressedBuffer.toString("base64");
}

async function emailImage(image, configuration, azureCredential) {
	const emailClient = new azureCommunication.EmailClient("https://communication-service-6293.unitedstates.communication.azure.com", azureCredential);
	const message = {
		senderAddress: configuration.senderEmailAddress,
		content: {
			subject: "Image for Picture Frame",
			plainText: "Image is attached."
		},
		recipients: {
			to: [
				{
					address: configuration.pictureFrameEmailAddress,
					displayName: "Picture Frame"
				}
			]
		},
		attachments: [
			{
				name: image.name,
				contentType: "image/png",
				contentInBase64: image.compressedBase64
			}
		]
	};
	  
	const poller = await emailClient.beginSend(message);
	await poller.pollUntilDone();  
}