terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "4.67.0"
    }
  }

  backend "s3" {
    bucket = "mchonedev-terraform-state"
    key    = "gpt-summarizer/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project = "GPT Summarizer"
    }
  }
}

resource "aws_s3_bucket" "artifact_bucket" {
  bucket = "mchonedev-gpt-summarizer"
}

resource "aws_security_group" "gpt_summarizer" {
  name        = "gpt-summarizer"
  description = "Security group for GPT Summarizer"

  ingress {
    description = "Allow inbound HTTP traffic"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Allow outbound HTTPs traffic"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

data "aws_ssm_parameter" "amazon_linux_ami" {
  name = "/aws/service/ami-amazon-linux-latest/amzn2-ami-hvm-x86_64-gp2"
}

resource "aws_instance" "gpt_summarizer" {
  ami                    = data.aws_ssm_parameter.amazon_linux_ami.value
  instance_type          = "t3a.micro"
  vpc_security_group_ids = [aws_security_group.gpt_summarizer.id]
  key_name               = "mchonedev"

  tags = {
    Name = "gpt-summarizer"
  }

  user_data = <<-EOF
              # install nodejs and yt-dlp
              yum install -y nodejs git
              sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
              sudo chmod a+rx /usr/local/bin/yt-dlp

              cd ~
              git clone https://github.com/BenMcH/gpt-youtube-summarizer

              cd gpt-youtube-summarizer
              npm install
              node index.js
              
              EOF
}
